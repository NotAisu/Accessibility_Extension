/**
 * Runs the Check over every ground-truth set and fails when precision or recall of any
 * WCAG criterion drops below the stored baseline of its language.
 *   npm run test:gate                 compare with baseline/<languageId>.json
 *   npm run test:gate -- --update     store the current scores as the new baselines
 *   npm run test:gate -- --bundle <dir>  measure the analysis bundle in <dir>/dist instead of the source
 *
 * It also computes which rules are Proven rules from the evidence sets and fails when that differs from the
 * committed proof status (src/core/proof-status.json), which --update rewrites with the baselines.
 *
 * Evidence sets are labelled independently of the engines: the W3C ACT Rules test cases (act), real pages and
 * component files labelled per Finding (field), and real files with one inserted failure (injection,
 * generate-injection.ts). The other sets are engine-wiring sets imported from each engine's own rule tests: they
 * catch bundling and mapping regressions, but an engine passes its own tests, so they never count as evidence.
 */
import '../esm-only-packages';
import * as fs from 'fs';
import * as path from 'path';
import { AnalysisWorker } from '../../src/analysis-worker';
import * as source from '../../src/core/analysis';
import type { NeedsReview, TextRange } from '../../src/core/analysis';
import { GroundTruthSet, Tally, addTallies, precision, recall, scoreCase } from './ground-truth';
import { Judged, ProofStatus, addJudged, judgeMatches, proofChanges, proofStatus } from './proof';

const SETS = ['act', 'jsx-a11y', 'vuejs-accessibility', 'own', 'svelte', 'astro', 'angular-eslint', 'field', 'injection']
    .filter(name => fs.existsSync(path.join(__dirname, name, 'expectations.json')));
// Independently labelled real code. The engine-wiring sets (imported from the engines' own rule tests) and own
// cases never count as evidence that a rule is right (#78).
const EVIDENCE = new Set(['act', 'field', 'injection']);
const PROOF_STATUS = path.join(__dirname, '..', '..', 'src', 'core', 'proof-status.json');
// One file per language, so work on different languages never touches the same baseline
const BASELINES = path.join(__dirname, 'baseline');

type Scores = Record<string, { precision: number | null; recall: number | null } & Tally>;

type Analyse = typeof source.analyse;

interface Measured {
    scoresByLanguage: Map<string, Scores>;
    proof: ProofStatus;
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

async function measure(analyse: Analyse, silent: Set<string>): Promise<Measured> {
    const totals = new Map<string, Map<string, Tally>>();
    const judged = new Map<string, Map<string, Judged>>();
    const failingCaseFindings = new Map<string, number>();
    for (const name of SETS) {
        const dir = path.join(__dirname, name);
        const set = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf-8')) as GroundTruthSet;
        for (const testCase of set.cases) {
            const text = fs.readFileSync(path.join(dir, testCase.file), 'utf-8');
            const { findings, needsReview } = await analyse({ languageId: testCase.languageId, text });
            // A likely failure points at its element, so it is judged like a Finding
            const located = needsReview.flatMap(entry => entry.range ? [{ range: entry.range, criteria: [entry.criterion] }] : []);
            const reported = [...findings, ...located].map(f => ({ line: lineAt(text, f.range.start), criteria: f.criteria }));
            // An Unproven rule's match is judged like a Finding, so the proof never depends on the proof status
            const matches = [...findings, ...demoted(needsReview)].map(f => ({ ruleId: f.ruleId, line: lineAt(text, f.range.start), criteria: f.criteria }));
            if (testCase.expect.some(e => !('present' in e) || e.present)) {
                failingCaseFindings.set(testCase.languageId, (failingCaseFindings.get(testCase.languageId) ?? 0) + matches.length);
            }
            if (!totals.has(testCase.languageId)) totals.set(testCase.languageId, new Map());
            addTallies(totals.get(testCase.languageId)!, scoreCase(testCase.expect, reported));
            if (EVIDENCE.has(name)) {
                if (!judged.has(testCase.languageId)) judged.set(testCase.languageId, new Map());
                addJudged(judged.get(testCase.languageId)!, judgeMatches(testCase, matches));
            }
        }
    }
    // An engine that loads badly often reports nothing at all rather than failing
    for (const [languageId, count] of failingCaseFindings) if (count === 0) silent.add(languageId);
    const scoresByLanguage = new Map<string, Scores>();
    for (const [languageId, tallies] of totals) {
        const scores: Scores = {};
        for (const criterion of [...tallies.keys()].sort(byCriterion)) {
            const t = tallies.get(criterion)!;
            scores[criterion] = { precision: round(precision(t)), recall: round(recall(t)), ...t };
        }
        scoresByLanguage.set(languageId, scores);
    }
    return { scoresByLanguage, proof: proofStatus(judged) };
}

function lineAt(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
    return line;
}

function round(value: number | null): number | null {
    return value === null ? null : Math.round(value * 1000) / 1000;
}

function byCriterion(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

function format(value: number | null): string {
    return value === null ? '   –' : value.toFixed(2);
}

function regressions(scores: Scores, baseline: Scores): string[] {
    const problems: string[] = [];
    for (const [criterion, base] of Object.entries(baseline)) {
        const now = scores[criterion];
        if (!now) {
            problems.push(`${criterion}: no longer measured`);
            continue;
        }
        for (const metric of ['precision', 'recall'] as const) {
            const was = base[metric];
            const is = now[metric];
            // Without a baseline value (nothing reported yet), any false positive is a regression
            const dropped = was === null ? metric === 'precision' && is !== null && is < 1 : is === null || is < was;
            if (dropped) {
                problems.push(`${criterion}: ${metric} ${format(is)} < baseline ${format(was)}`);
            }
        }
    }
    return problems;
}

// The bundle is measured through the analysis worker, exactly as the extension runs it
function loadAnalyse(): Analyse {
    const index = process.argv.indexOf('--bundle');
    if (index === -1) return source.analyse;
    const script = path.resolve(process.argv[index + 1], 'dist', 'worker.mjs');
    console.log(`Measuring the bundle ${script}`);
    // The gate measures what the Check finds, not how fast; a slow CI machine must not fail it
    const worker = new AnalysisWorker(script, { deadlineMs: 30_000 });
    let request = 0;
    return async document => {
        const outcome = await worker.check(String(request++), document);
        if (outcome.status !== 'done') throw new Error(`The analysis worker did not check a case: ${JSON.stringify(outcome)}`);
        return outcome.result;
    };
}

async function main() {
    const silent = new Set<string>();
    const { scoresByLanguage, proof } = await measure(loadAnalyse(), silent);
    const update = process.argv.includes('--update');
    const problems = [...silent].map(languageId => `${languageId}: no Findings on the cases that expect one`);
    if (update && problems.length > 0) {
        console.error(`\nNo baseline written:\n  ${problems.join('\n  ')}`);
        process.exit(1);
    }

    for (const [languageId, scores] of scoresByLanguage) {
        console.log(`\n${languageId}\ncriterion  precision  recall    tp   fp   fn`);
        for (const [criterion, s] of Object.entries(scores)) {
            console.log(`${criterion.padEnd(9)}  ${format(s.precision).padStart(9)}  ${format(s.recall).padStart(6)}  ${String(s.tp).padStart(4)} ${String(s.fp).padStart(4)} ${String(s.fn).padStart(4)}`);
        }
        const file = path.join(BASELINES, `${languageId}.json`);
        if (update) {
            fs.mkdirSync(BASELINES, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(scores, null, 2) + '\n');
            console.log(`Baseline written to ${path.relative(process.cwd(), file)}`);
        } else if (!fs.existsSync(file)) {
            problems.push(`${languageId}: no baseline, run npm run test:gate -- --update and commit ${path.relative(process.cwd(), file)}`);
        } else {
            const baseline = JSON.parse(fs.readFileSync(file, 'utf-8')) as Scores;
            problems.push(...regressions(scores, baseline).map(problem => `${languageId} ${problem}`));
        }
    }
    printProof(proof);
    if (update) {
        fs.writeFileSync(PROOF_STATUS, JSON.stringify(proof, null, 2) + '\n');
        console.log(`Proof status written to ${path.relative(process.cwd(), PROOF_STATUS)}`);
        return;
    }
    if (!fs.existsSync(PROOF_STATUS)) {
        problems.push(`no proof status, run npm run test:gate -- --update and commit ${path.relative(process.cwd(), PROOF_STATUS)}`);
    } else {
        problems.push(...proofChanges(JSON.parse(fs.readFileSync(PROOF_STATUS, 'utf-8')) as ProofStatus, proof));
    }

    // A language whose ground truth disappeared must not pass silently
    for (const file of fs.existsSync(BASELINES) ? fs.readdirSync(BASELINES).filter(f => f.endsWith('.json')) : []) {
        const languageId = path.basename(file, '.json');
        if (!scoresByLanguage.has(languageId)) problems.push(`${languageId}: baseline exists but no ground truth was measured`);
    }
    if (problems.length > 0) {
        console.error(`\nCheck quality dropped below the baseline:\n  ${problems.join('\n  ')}`);
        process.exit(1);
    }
    console.log('\nNo criterion below the baseline.');
}

function printProof(proof: ProofStatus): void {
    console.log(`\nProof status (lower bound at ${proof.confidence * 100} %, Proven from ${proof.threshold})\nlanguage         rule                                 correct wrong  bound`);
    for (const [ruleId, languages] of Object.entries(proof.rules)) {
        for (const [languageId, p] of Object.entries(languages)) {
            console.log(`${languageId.padEnd(16)} ${ruleId.padEnd(36)} ${String(p.correct).padStart(7)} ${String(p.wrong).padStart(5)}  ${p.lowerBound.toFixed(3)}${p.proven ? '  Proven' : ''}`);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
