import { withoutIgnored } from './ignore';
import { withFixes } from './fixes';
import type { ComponentMapping } from './components';
import proofStatus from './proof-status.json';
import bestPracticeRules from './best-practice-rules.json';

/** Character offsets into the analysed text, end exclusive. */
export interface TextRange {
    start: number;
    end: number;
}

export interface FixEdit {
    range: TextRange;
    newText: string;
}

export type Layer = 'check' | 'ai-review';
export type Severity = 'error' | 'warning' | 'information';

export interface Finding {
    range: TextRange;
    /** WCAG 2.2 A/AA success criteria the problem fails, the primary one first. */
    criteria: string[];
    ruleId: string;
    layer: Layer;
    severity: Severity;
    /** One line naming the problem. */
    message: string;
    /** Why it is a problem and how to fix it. */
    explanation: string;
    helpUrl: string;
    fix?: FixEdit[];
    /** The fix guesses part of its edit, so it is only offered as a quick fix, never applied by source.fixAll or on save. */
    quickFixOnly?: true;
}

/** A criterion relevant to the document that the Check cannot decide from source. */
export interface NeedsReview {
    criterion: string;
    reason: string;
    /** The element a likely failure points at; entries about the whole document have none. */
    range?: TextRange;
    /** The Unproven rule whose match this is: a likely failure the rule has not yet proven its precision on. */
    ruleId?: string;
}

/** The Check's engines, one per framework, and the language ids each checks. */
export const ENGINES: Record<string, string[]> = {
    html: ['html'],
    jsx: ['javascriptreact', 'typescriptreact'],
    vue: ['vue'],
    svelte: ['svelte'],
    astro: ['astro'],
    angular: ['angular', 'typescript']
};

export interface AnalysisDocument {
    languageId: string;
    text: string;
}

/**
 * The language id the Check analyses a file as. VS Code has no language for Angular component templates,
 * which are HTML files named *.component.html; they are checked as `angular`.
 */
export function checkLanguageId(languageId: string, fileName: string): string {
    return languageId === 'html' && /\.component\.html$/i.test(fileName) ? 'angular' : languageId;
}

/** Whether the Check analyses the document at all: TypeScript files only for the inline templates of Angular components. */
export function isChecked(document: AnalysisDocument): boolean {
    return document.languageId !== 'typescript' || document.text.includes('@Component(');
}

/** A rule turned off, or the severity its Findings are reported with. */
export type RuleSetting = 'off' | Severity;

export interface AnalysisOptions {
    /** Per rule id; rules without a setting keep their default severity. */
    rules?: Record<string, RuleSetting>;
    /** The native elements project components render, for every engine that reads markup. */
    components?: ComponentMapping;
    /** Which rules are Proven rules; the bundled proof status unless a test of the engines checks every rule. */
    proven?: (ruleId: string, languageId: string) => boolean;
}

export interface AnalysisResult {
    findings: Finding[];
    needsReview: NeedsReview[];
}

/** The document cannot be parsed, so the Check cannot decide anything about it; not an engine failure. */
export class ParseError extends Error {
    /**
     * `position`: where parsing failed, such as `2:5` or `offset 37`; unlike the parser's message it never quotes
     * the code, so it alone may be logged.
     */
    constructor(readonly position: string, detail: string) {
        super(`Parse error at ${position}: ${detail}`);
        this.name = 'ParseError';
    }
}

/** A rule's evidence in one language: its judged matches on the evidence sets and the lower bound of its precision. */
export interface RuleProof {
    correct: number;
    wrong: number;
    lowerBound: number;
    proven: boolean;
}

const PROOF = proofStatus.rules as Record<string, Record<string, RuleProof | undefined> | undefined>;

/** A rule's evidence in a language, from the bundled proof status the gate computes (#78). */
export function proofOf(ruleId: string, languageId: string): RuleProof | undefined {
    return PROOF[ruleId]?.[languageId];
}

/**
 * Best-practice rules per language: they flag a coding convention, not a WCAG failure. A positive tabindex fails
 * 2.4.3 only when the order it makes loses meaning (F44), and link text like "click here" passes 2.4.4 in its
 * context; a redundant "image of" in alt text is still a text alternative (1.1.1).
 */
const BEST_PRACTICE = bestPracticeRules as Record<string, string[] | undefined>;

/** Whether a rule is a Best-practice rule in a language: never a Proven rule, its matches stay Needs Review. */
export function isBestPractice(ruleId: string, languageId: string): boolean {
    return BEST_PRACTICE[languageId]?.includes(ruleId) === true;
}

/** Whether a rule is a Proven rule in a language; a Best-practice rule never is, whatever its evidence. */
export function isProven(ruleId: string, languageId: string): boolean {
    return !isBestPractice(ruleId, languageId) && proofOf(ruleId, languageId)?.proven === true;
}

/**
 * Only Proven rules report Findings. An Unproven rule's match is a Needs Review entry per criterion at its element,
 * whatever its setting says, since no setting can promote it.
 */
export async function analyse(document: AnalysisDocument, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    const { findings, needsReview } = await check(document, options.components);
    const rules = options.rules ?? {};
    const matches = withoutIgnored(document, findings).filter(finding => rules[finding.ruleId] !== 'off');
    const isProvenRule = options.proven ?? isProven;
    const proven = matches.filter(finding => isProvenRule(finding.ruleId, document.languageId));
    const unproven = matches.filter(finding => !proven.includes(finding));
    return {
        findings: withFixes(document.text, proven).map(finding => {
            const setting = rules[finding.ruleId];
            return setting && setting !== 'off' ? { ...finding, severity: setting } : finding;
        }),
        needsReview: [
            ...needsReview,
            ...unproven.flatMap(finding => finding.criteria.map(criterion => ({
                criterion,
                reason: isBestPractice(finding.ruleId, document.languageId)
                    ? `Convention, verify: ${finding.message} (${finding.ruleId} is a Best-practice rule: it flags a coding convention, not a WCAG failure)`
                    : `Likely failure, verify: ${finding.message} (${finding.ruleId} is not yet a Proven rule)`,
                range: finding.range,
                ruleId: finding.ruleId
            })))
        ]
    };
}

async function check(document: AnalysisDocument, components?: ComponentMapping): Promise<AnalysisResult> {
    if (!document.text.trim()) return { findings: [], needsReview: [] };
    if (document.languageId === 'javascriptreact' || document.languageId === 'typescriptreact') {
        const { checkJsx } = await import('./jsx/engine');
        const { findings, needsReview } = checkJsx(document.text, document.languageId === 'typescriptreact', components);
        return { findings: sortByPosition(findings), needsReview };
    }
    if (document.languageId === 'vue') {
        const { checkVue } = await import('./vue/engine');
        const { findings, needsReview } = checkVue(document.text, components);
        return { findings: sortByPosition(findings), needsReview };
    }
    if (document.languageId === 'svelte') {
        const { checkSvelte } = await import('./svelte/engine');
        const { findings, needsReview } = checkSvelte(document.text, components);
        return { findings: sortByPosition(findings), needsReview };
    }
    if (document.languageId === 'astro') {
        const { checkAstro } = await import('./astro/engine');
        const { findings, needsReview } = checkAstro(document.text, components);
        return { findings: sortByPosition(findings), needsReview };
    }
    // Angular component templates are inline in TypeScript files that call @Component(; other files never
    // load the engine
    if (!isChecked(document)) return { findings: [], needsReview: [] };
    if (document.languageId === 'angular' || document.languageId === 'typescript') {
        const { checkAngularTemplate, checkAngularComponents } = await import('./angular/engine');
        const checkAngular = document.languageId === 'angular' ? checkAngularTemplate : checkAngularComponents;
        const { findings, needsReview } = checkAngular(document.text, components);
        return { findings: sortByPosition(findings), needsReview };
    }
    if (document.languageId !== 'html') return { findings: [], needsReview: [] };
    const { checkHtmlWithAxe, checkHtmlWithEslint } = await import('./html/engine');
    const axe = await checkHtmlWithAxe(document.text);
    const eslint = checkHtmlWithEslint(document.text);
    return {
        findings: sortByPosition([...axe.findings, ...notReportedBy(axe.findings, eslint)]),
        needsReview: axe.needsReview
    };
}

// Both engines can flag the same problem (a missing lang); axe-core's Finding explains more, so it wins
function notReportedBy(reported: Finding[], findings: Finding[]): Finding[] {
    return findings.filter(finding => !reported.some(other =>
        overlaps(other.range, finding.range) && other.criteria.some(c => finding.criteria.includes(c))
    ));
}

// Ranges sharing a start also count, so zero-length ranges can overlap
function overlaps(a: TextRange, b: TextRange): boolean {
    return (a.start < b.end && b.start < a.end) || a.start === b.start;
}

function sortByPosition(findings: Finding[]): Finding[] {
    return findings.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
}
