/**
 * Which Check rules are Proven rules: the one-sided Clopper-Pearson lower bound of a rule's precision on the
 * evidence sets, per language, against the threshold of the proof policy (#78).
 */
import type { Finding, NeedsReview, TextRange } from '../../src/core/analysis';
import type { Expectation } from './ground-truth';
import bestPracticeRules from '../../src/core/best-practice-rules.json';

/** Best-practice rules per language, bundled beside the proof status: never Proven, whatever their evidence. */
export const BEST_PRACTICE_RULES: Record<string, string[]> = bestPracticeRules;

export const CONFIDENCE = 0.95;
export const THRESHOLD = 0.95;

/** A Finding, or an Unproven rule's Needs Review entry, reduced to what the ground truth can judge. */
export interface RuleMatch {
    ruleId: string;
    line: number;
    criteria: string[];
}

/**
 * Every rule match of a result at its line: the Findings and the Unproven rules' matches, which the Check lists as
 * Needs Review entries. An Unproven rule's match is judged like a Finding, so the proof never depends on the proof status.
 */
export function ruleMatches(text: string, result: { findings: Pick<Finding, 'ruleId' | 'range' | 'criteria'>[]; needsReview: NeedsReview[] }): RuleMatch[] {
    return [...result.findings, ...demoted(result.needsReview)].map(f => ({ ruleId: f.ruleId, line: lineAt(text, f.range.start), criteria: f.criteria }));
}

// The Needs Review entries of one Unproven rule's match, one per criterion, joined back into the match
function demoted(needsReview: NeedsReview[]): { ruleId: string; range: TextRange; criteria: string[] }[] {
    const byMatch = new Map<string, { ruleId: string; range: TextRange; criteria: string[] }>();
    for (const entry of needsReview) {
        if (!entry.ruleId || !entry.range) continue;
        const key = `${entry.ruleId} ${entry.range.start} ${entry.range.end}`;
        if (!byMatch.has(key)) byMatch.set(key, { ruleId: entry.ruleId, range: entry.range, criteria: [] });
        byMatch.get(key)!.criteria.push(entry.criterion);
    }
    return [...byMatch.values()];
}

export function lineAt(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
    return line;
}

export interface Judged {
    correct: number;
    wrong: number;
}

export interface RuleProof extends Judged {
    lowerBound: number;
    proven: boolean;
}

/** The committed proof status: per rule id and language id. */
export interface ProofStatus {
    confidence: number;
    threshold: number;
    rules: Record<string, Record<string, RuleProof>>;
}

/**
 * Judges each match of a case. A match is correct when one of its criteria fails where it points, wrong when
 * the case labels its criteria and none fails there, and unjudged when the case says nothing about them. On a
 * `complete` case every criterion is labelled, so an unlabelled match is wrong.
 */
export function judgeMatches(testCase: { expect: Expectation[]; complete?: boolean }, matches: RuleMatch[]): Map<string, Judged> {
    const judged = new Map<string, Judged>();
    for (const match of matches) {
        const outcome = judgeMatch(testCase, match);
        if (!outcome) continue;
        const sum = judged.get(match.ruleId) ?? { correct: 0, wrong: 0 };
        sum[outcome]++;
        judged.set(match.ruleId, sum);
    }
    return judged;
}

function judgeMatch(testCase: { expect: Expectation[]; complete?: boolean }, match: RuleMatch): 'correct' | 'wrong' | undefined {
    const verdicts = match.criteria.map(criterion => verdict(testCase, criterion, match.line));
    return verdicts.includes('correct') ? 'correct' : verdicts.includes('wrong') ? 'wrong' : undefined;
}

/**
 * The judgement of one evidence case, as the gate stores it with the baselines: its matches judged correct and
 * wrong (`rule@line`), and its labelled failures no correct match points at (`criterion@line`, or the criterion
 * of a failure labelled without a line). Empty lists are left out.
 */
export interface CaseJudgement {
    correct?: string[];
    wrong?: string[];
    missed?: string[];
}

/** Per language id, per case (`set/file`): the judgement of every evidence case. */
export type CaseJudgements = Record<string, Record<string, CaseJudgement>>;

export function judgeCase(testCase: { expect: Expectation[]; complete?: boolean }, matches: RuleMatch[]): CaseJudgement {
    const judgement: CaseJudgement = {};
    const add = (kind: keyof CaseJudgement, entry: string) => {
        const list = judgement[kind] ??= [];
        if (!list.includes(entry)) list.push(entry);
    };
    for (const match of matches) {
        const outcome = judgeMatch(testCase, match);
        if (outcome) add(outcome, `${match.ruleId}@${match.line}`);
    }
    const correct = matches.filter(match => judgeMatch(testCase, match) === 'correct');
    for (const label of testCase.expect) {
        if ('line' in label) {
            if (!correct.some(m => m.line === label.line && m.criteria.includes(label.criterion))) add('missed', `${label.criterion}@${label.line}`);
        } else if (label.present && !correct.some(m => m.criteria.includes(label.criterion))) {
            add('missed', label.criterion);
        }
    }
    for (const list of Object.values(judgement) as string[][]) list.sort(byLine);
    return judgement;
}

function byLine(a: string, b: string): number {
    const line = (entry: string) => Number(entry.split('@')[1] ?? 0);
    return line(a) - line(b) || a.localeCompare(b);
}

/**
 * Every case whose judgement changed between the baseline and now, with language, file, line and rule (or the
 * criterion of a missed failure): first what is newly correct, wrong or missed, then what no longer is.
 */
export function caseChanges(baseline: CaseJudgements, current: CaseJudgements): string[] {
    const changes: string[] = [];
    const kinds = ['correct', 'wrong', 'missed'] as const;
    for (const languageId of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) {
        const was = baseline[languageId] ?? {};
        const is = current[languageId] ?? {};
        for (const file of [...new Set([...Object.keys(was), ...Object.keys(is)])].sort()) {
            if (!is[file]) {
                changes.push(`${languageId} ${file}: no longer measured`);
                continue;
            }
            const before = was[file] ?? {};
            const after = is[file];
            const show = (entry: string, change: string) => {
                const at = entry.lastIndexOf('@');
                return at === -1 ? `${languageId} ${file} ${entry}: ${change}` : `${languageId} ${file}:${entry.slice(at + 1)} ${entry.slice(0, at)}: ${change}`;
            };
            for (const kind of kinds) for (const entry of after[kind] ?? []) if (!before[kind]?.includes(entry)) changes.push(show(entry, `newly ${kind}`));
            for (const kind of kinds) for (const entry of before[kind] ?? []) if (!after[kind]?.includes(entry)) changes.push(show(entry, `no longer ${kind}`));
        }
    }
    return changes;
}

function verdict(testCase: { expect: Expectation[]; complete?: boolean }, criterion: string, line: number): 'correct' | 'wrong' | undefined {
    const labels = testCase.expect.filter(e => e.criterion === criterion);
    const lines = labels.flatMap(e => 'line' in e ? [e.line] : []);
    if (lines.length > 0) return lines.includes(line) ? 'correct' : 'wrong';
    const present = labels.find(e => 'present' in e);
    if (present && 'present' in present) return present.present ? 'correct' : 'wrong';
    return testCase.complete ? 'wrong' : undefined;
}

/**
 * Tells whether a case's text repeats an earlier evidence case in the same language, and names that case. A file
 * copied twice, or an upstream set that lists the same test twice, would otherwise count as two pieces of evidence.
 * A repeat labelled differently throws: one of the two labels is wrong, and dropping either would hide which.
 */
export function repeatedEvidence(): (languageId: string, file: string, text: string, expect: unknown) => string | undefined {
    const first = new Map<string, { file: string; labels: string }>();
    return (languageId, file, text, expect) => {
        const key = `${languageId}\0${text}`;
        const labels = JSON.stringify(expect);
        const earlier = first.get(key);
        if (earlier === undefined) first.set(key, { file, labels });
        else if (earlier.labels !== labels) throw new Error(`${file} and ${earlier.file} have the same text but different labels`);
        return earlier?.file;
    };
}

export function addJudged(into: Map<string, Judged>, from: Map<string, Judged>): void {
    for (const [ruleId, j] of from) {
        const sum = into.get(ruleId) ?? { correct: 0, wrong: 0 };
        into.set(ruleId, { correct: sum.correct + j.correct, wrong: sum.wrong + j.wrong });
    }
}

/** One-sided Clopper-Pearson lower bound of a proportion: the p at which `correct` or more of `total` has probability 1 − confidence. */
export function lowerBound(correct: number, total: number, confidence = CONFIDENCE): number {
    if (correct === 0) return 0;
    const alpha = 1 - confidence;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 60; i++) {
        const p = (low + high) / 2;
        if (upperTail(correct, total, p) < alpha) low = p; else high = p;
    }
    return low;
}

// P(X >= k) for X ~ Binomial(n, p), summed in log space so large n stays exact enough
function upperTail(k: number, n: number, p: number): number {
    const logFactorial = (m: number) => { let s = 0; for (let i = 2; i <= m; i++) s += Math.log(i); return s; };
    const logNFact = logFactorial(n);
    let sum = 0;
    let logKFact = logFactorial(k);
    let logRestFact = logFactorial(n - k);
    for (let i = k; i <= n; i++) {
        if (i > k) {
            logKFact += Math.log(i);
            logRestFact -= Math.log(n - i + 1);
        }
        sum += Math.exp(logNFact - logKFact - logRestFact + i * Math.log(p) + (n - i) * Math.log1p(-p));
    }
    return sum;
}

/** The proof status of every rule with evidence, from its judged matches per language; a Best-practice rule is never proven. */
export function proofStatus(judgedByLanguage: Map<string, Map<string, Judged>>, bestPractice: Record<string, string[]> = BEST_PRACTICE_RULES): ProofStatus {
    const rules: ProofStatus['rules'] = {};
    for (const languageId of [...judgedByLanguage.keys()].sort()) {
        for (const [ruleId, j] of [...judgedByLanguage.get(languageId)!].sort(([a], [b]) => a.localeCompare(b))) {
            const bound = lowerBound(j.correct, j.correct + j.wrong);
            (rules[ruleId] ??= {})[languageId] = { ...j, lowerBound: Math.floor(bound * 1000) / 1000, proven: bound >= THRESHOLD && !bestPractice[languageId]?.includes(ruleId) };
        }
    }
    return { confidence: CONFIDENCE, threshold: THRESHOLD, rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))) };
}

/** What changed between the committed and the computed proof status; a Proven rule that fell below the threshold comes first. */
export function proofChanges(committed: ProofStatus, computed: ProofStatus): string[] {
    const demoted: string[] = [];
    const changed: string[] = [];
    const keys = new Set([...Object.keys(committed.rules), ...Object.keys(computed.rules)]);
    for (const ruleId of [...keys].sort()) {
        const languages = new Set([...Object.keys(committed.rules[ruleId] ?? {}), ...Object.keys(computed.rules[ruleId] ?? {})]);
        for (const languageId of [...languages].sort()) {
            const was = committed.rules[ruleId]?.[languageId];
            const is = computed.rules[ruleId]?.[languageId];
            if (was?.proven && !is?.proven) {
                demoted.push(`${languageId} ${ruleId}: Proven rule fell below ${THRESHOLD} (lower bound ${is?.lowerBound ?? 0}, ${is?.wrong ?? 0} false positives in ${(is?.correct ?? 0) + (is?.wrong ?? 0)})`);
            } else if (JSON.stringify(was) !== JSON.stringify(is)) {
                changed.push(`${languageId} ${ruleId}: proof status out of date (${describe(was)} → ${describe(is)})`);
            }
        }
    }
    if (committed.threshold !== computed.threshold || committed.confidence !== computed.confidence) changed.unshift('proof policy changed');
    return [...demoted, ...changed];
}

function describe(proof: RuleProof | undefined): string {
    return proof ? `${proof.correct}/${proof.correct + proof.wrong}, ${proof.proven ? 'Proven' : 'Unproven'}` : 'no evidence';
}
