import { JSDOM } from 'jsdom';
import * as axe from 'axe-core';
import { normalizeRuleId } from './rule-id-normalizer';

export interface HtmlFinding {
    ruleId: string;
    originalRuleId: string;
    help: string;
    // Character offsets into the checked text
    start: number;
    end: number;
}

const AXE_TIMEOUT_MS = 5000;

const AXE_OPTIONS: axe.RunOptions = {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'] },
    resultTypes: ['violations'],
    // JSDOM has no layout, so rules that need rendering cannot be decided
    rules: {
        'color-contrast': { enabled: false },
        'color-contrast-enhanced': { enabled: false },
        'target-size': { enabled: false }
    },
    preload: false
};

// axe-core refuses concurrent runs, so checks are queued
let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs axe-core over the text in a JSDOM document. JSDOM's default script handling
 * is kept, so scripts in the checked file are parsed but never executed.
 */
export function checkHtml(text: string): Promise<HtmlFinding[]> {
    const run = queue.then(() => runAxe(text));
    queue = run.catch(() => undefined);
    return run;
}

async function runAxe(text: string): Promise<HtmlFinding[]> {
    if (!text) return [];

    const { window } = new JSDOM(text);
    try {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('axe-timeout')), AXE_TIMEOUT_MS);
        });
        const results = await Promise.race([axe.run(window.document.documentElement, AXE_OPTIONS), timeout])
            .finally(() => clearTimeout(timer));
        return toFindings(text, results.violations);
    } finally {
        window.close();
    }
}

function toFindings(text: string, violations: axe.Result[]): HtmlFinding[] {
    const findings: HtmlFinding[] = [];
    for (const violation of violations) {
        for (const node of violation.nodes) {
            const location = locate(text, node);
            if (!location) continue;
            findings.push({
                ruleId: normalizeRuleId(violation.id) || violation.id,
                originalRuleId: violation.id,
                help: violation.help,
                ...location
            });
        }
    }
    return findings;
}

function locate(text: string, node: axe.NodeResult): { start: number; end: number } | undefined {
    if (node.target.length === 1 && node.target[0] === 'html') {
        const match = text.match(/<html[^>]*>/i);
        if (match && typeof match.index === 'number') {
            return { start: match.index, end: match.index + match[0].length };
        }
        return undefined;
    }
    const index = text.indexOf(node.html);
    return index === -1 ? undefined : { start: index, end: index + node.html.length };
}
