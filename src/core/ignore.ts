import type { AnalysisDocument, Finding } from './analysis';
import { lineOffsets } from './offsets';

// Markup comments in HTML, Vue and Svelte; block comments in JSX, usually as an expression `{/* … */}`
const MARKUP_COMMENT = /<!--\s*allyproof-ignore\b([\s\S]*?)-->/g;
const JSX_COMMENT = /\/\*\s*allyproof-ignore\b([\s\S]*?)\*\//g;
const JSX_LANGUAGES = ['javascriptreact', 'typescriptreact'];

/** Drops the Findings an ignore comment on the line above names; stacked ignore comments all apply to the line below them. */
export function withoutIgnored(document: AnalysisDocument, findings: Finding[]): Finding[] {
    const lineStarts = lineOffsets(document.text);
    const lineOf = (offset: number) => lineStarts.filter(start => start <= offset).length;
    const comments = [...document.text.matchAll(JSX_LANGUAGES.includes(document.languageId) ? JSX_COMMENT : MARKUP_COMMENT)].map(match => ({
        startLine: lineOf(match.index),
        target: lineOf(match.index + match[0].length) + 1,
        rules: match[1].split(/[\s,]+/).filter(Boolean)
    }));
    // From the last comment up, so a comment above another one inherits its already resolved target
    for (const comment of [...comments].reverse()) {
        comment.target = comments.find(below => below.startLine === comment.target)?.target ?? comment.target;
    }
    return findings.filter(finding => !comments.some(comment =>
        comment.target === lineOf(finding.range.start) && comment.rules.includes(finding.ruleId)
    ));
}

/** A line to insert at `offset`, the start of the Finding's line. */
export interface IgnoreLine {
    offset: number;
    text: string;
}

// Where a comment line can land outside markup: in a JSX expression or opening tag, or in TypeScript outside its
// inline Angular template. A JSX expression comment is only valid among children; a plain block comment elsewhere
const CHECKED_LANGUAGES = [...JSX_LANGUAGES, 'typescript'];

/**
 * The comment line that ignores the Finding on the line below it, in the first form after which the document still
 * parses and the Finding is gone; undefined when no form does. `check` returns undefined when the document does not
 * parse.
 */
export async function ignoreLine(
    document: AnalysisDocument,
    finding: Pick<Finding, 'range' | 'ruleId'>,
    check: (document: AnalysisDocument) => Promise<Finding[] | undefined>
): Promise<IgnoreLine | undefined> {
    const { languageId, text } = document;
    const offset = text.lastIndexOf('\n', finding.range.start - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(offset))![0];
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const comments = JSX_LANGUAGES.includes(languageId)
        ? [`{/* allyproof-ignore ${finding.ruleId} */}`, `/* allyproof-ignore ${finding.ruleId} */`]
        : [`<!-- allyproof-ignore ${finding.ruleId} -->`];
    for (const comment of comments) {
        const line = { offset, text: `${indent}${comment}${eol}` };
        if (!CHECKED_LANGUAGES.includes(languageId)) return line;
        const findings = await check({ languageId, text: text.slice(0, offset) + line.text + text.slice(offset) });
        const start = finding.range.start + line.text.length;
        if (findings?.every(f => f.ruleId !== finding.ruleId || f.range.start !== start)) return line;
    }
    return undefined;
}
