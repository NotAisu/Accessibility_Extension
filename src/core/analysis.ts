import { withoutIgnored } from './ignore';
import { withFixes } from './fixes';
import type { ComponentMapping } from './components';

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

export async function analyse(document: AnalysisDocument, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    const { findings, needsReview } = await check(document, options.components);
    const rules = options.rules ?? {};
    return {
        findings: withFixes(document.text, withoutIgnored(document, findings)).flatMap(finding => {
            const setting = rules[finding.ruleId];
            if (setting === 'off') return [];
            return [setting ? { ...finding, severity: setting } : finding];
        }),
        needsReview
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
