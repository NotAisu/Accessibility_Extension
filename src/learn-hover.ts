import type { Finding } from './core/analysis';
import { frameworkOf, ruleDoc, type Example } from './core/rule-docs';
import { criterionName, criterionUrl } from './core/wcag';

// The learn hover of a Check Finding as plain Markdown: no HTML and no images, so it reads the same in the
// Accessible View and next to Error Lens. Its only command links are these.
export const HOVER_COMMANDS: readonly string[] = ['allyproof.ignoreFinding', 'allyproof.disableRule', 'allyproof.startAIReview'];

export interface HoverTarget {
    /** The document the Finding is in. */
    uri: string;
    /** The document version the Finding was reported for. */
    version: number;
    /** Whether the AI Review can run, so the hover offers to start it. */
    aiReviewAvailable: boolean;
}

/** The argument of the `allyproof.ignoreFinding` command: the Finding of `ruleId` at `offset` of the document's `version`. */
export interface IgnoreFindingArgument {
    uri: string;
    ruleId: string;
    offset: number;
    version: number;
}

/** The diagnostic's message: the Finding's message on one line, with its criteria. */
export function diagnosticMessage(finding: Finding): string {
    return `${finding.message.replace(/\s*\n\s*/g, ' ')} (WCAG ${finding.criteria.join(', ')})`;
}

/** The hover of a Finding in a document of `languageId` (a Check language id). */
export function learnMarkdown(finding: Finding, languageId: string, target: HoverTarget): string {
    const doc = ruleDoc(finding.ruleId);
    const rule = `[Rule ${escape(finding.ruleId)}](${finding.helpUrl})`;
    if (!doc) {
        const criteria = finding.criteria.map(c => `[WCAG ${escape(`${c} ${criterionName(c)}`)}](${criterionUrl(c)})`);
        return [`**${escape(finding.message)}**`, escape(finding.explanation), [...criteria, rule].join(' · '), commands(finding, target)].join('\n\n');
    }
    const example = doc.examples[frameworkOf(languageId)];
    const links = [...doc.wcag, ...doc.act].map(link => `[${escape(link.title)}](${link.url})`);
    return [
        `**${prose(doc.message)}**`,
        prose(doc.why),
        `**How to fix:** ${prose(doc.fix)}`,
        ...doc.details ? [`**This Finding:** ${escape(finding.explanation)}`] : [],
        snippet(example.file ? `Bad, in \`${example.file}\`:` : 'Bad:', example, example.bad),
        snippet('Good:', example, example.good),
        [...links, rule].join(' · '),
        commands(finding, target)
    ].join('\n\n');
}

function snippet(label: string, example: Example, code: string): string {
    return `${label}\n\n\`\`\`${example.language}\n${code}\n\`\`\``;
}

function commands(finding: Finding, target: HoverTarget): string {
    const link = (title: string, command: string, args?: unknown[]) =>
        `[${title}](command:${command}${args ? `?${encodeURIComponent(JSON.stringify(args))}` : ''})`;
    return [
        link('Ignore this Finding', 'allyproof.ignoreFinding', [
            { uri: target.uri, ruleId: finding.ruleId, offset: finding.range.start, version: target.version } satisfies IgnoreFindingArgument
        ]),
        link('Disable rule', 'allyproof.disableRule', [finding.ruleId]),
        ...target.aiReviewAvailable ? [link('Start AI Review', 'allyproof.startAIReview')] : []
    ].join(' · ');
}

// Docs text: element and attribute examples such as <img> or alt="" as code spans, the rest escaped
function prose(text: string): string {
    return text.split(/(<[^<>]+>|\b[a-z-]+="[^"]*")/).map((part, i) => i % 2 ? `\`${part}\`` : escape(part)).join('');
}

function escape(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
