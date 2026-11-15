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
}

/** A criterion relevant to the document that the Check cannot decide from source. */
export interface NeedsReview {
    criterion: string;
    reason: string;
}

export interface AnalysisDocument {
    languageId: string;
    text: string;
}

export interface AnalysisResult {
    findings: Finding[];
    needsReview: NeedsReview[];
}

/** The document cannot be parsed, so the Check cannot decide anything about it; not an engine failure. */
export class ParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ParseError';
    }
}

export async function analyse(document: AnalysisDocument): Promise<AnalysisResult> {
    if (!document.text.trim()) return { findings: [], needsReview: [] };
    if (document.languageId === 'javascriptreact' || document.languageId === 'typescriptreact') {
        const { checkJsx } = await import('./jsx/engine');
        return {
            findings: sortByPosition(checkJsx(document.text, document.languageId === 'typescriptreact')),
            needsReview: []
        };
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
