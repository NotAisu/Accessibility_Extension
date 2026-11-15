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

/** The comment that ignores the rule's Findings on the line below it. */
export function ignoreComment(languageId: string, ruleId: string): string {
    return JSX_LANGUAGES.includes(languageId) ? `{/* allyproof-ignore ${ruleId} */}` : `<!-- allyproof-ignore ${ruleId} -->`;
}
