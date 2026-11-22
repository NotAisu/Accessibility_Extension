import { JSDOM, VirtualConsole } from 'jsdom';
// axe-core's teardown after a run sets its window to null, which crashes runVirtualRule in
// eslint-plugin-jsx-a11y-x (autocomplete-valid) when both share one axe-core instance
import * as axe from 'axe-core/axe.min.js';
import { normalizeRuleId } from '../rule-id-normalizer';
import { isTargetCriterion } from '../wcag';
import { withOwnRules } from '../own-rules';
import { addText, cssSetsColors, type SourceElement } from '../needs-review';
import type { AnalysisResult, Finding, TextRange } from '../analysis';

// JSDOM has no layout, so rules that need rendering cannot be decided
export const LAYOUT_RULES = ['color-contrast', 'target-size', 'link-in-text-block', 'scrollable-region-focusable'];

// The rules axe-core runs: those tagged with a WCAG 2.x level A or AA criterion
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

const AXE_OPTIONS: axe.RunOptions = {
    runOnly: { type: 'tag', values: AXE_TAGS },
    resultTypes: ['violations'],
    rules: Object.fromEntries(LAYOUT_RULES.map(rule => [rule, { enabled: false }])),
    elementRef: true,
    preload: false
};

// parse5 element locations; @types/jsdom only declares the outer offsets
interface ElementLocation {
    startOffset: number;
    endOffset: number;
    startTag?: { startOffset: number; endOffset: number };
}

// axe-core refuses concurrent runs, so checks are queued
let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs axe-core over the text in a JSDOM document. JSDOM's default script handling
 * is kept, so scripts in the checked file are parsed but never executed.
 */
export function checkHtmlWithAxe(text: string): Promise<AnalysisResult> {
    const run = queue.then(() => runAxe(text));
    queue = run.catch(() => undefined);
    return run;
}

async function runAxe(text: string): Promise<AnalysisResult> {
    // A silent console: JSDOM reports unimplemented APIs (canvas) that axe-core probes
    // A file's UTF-8 BOM is an encoding marker. Replacing it preserves every source offset.
    const source = text.startsWith('\uFEFF') ? ` ${text.slice(1)}` : text;
    const dom = new JSDOM(source, { includeNodeLocations: true, virtualConsole: new VirtualConsole() });
    const { document } = dom.window;
    // jsdom 30's UA stylesheet sets `marquee { overflow: hidden !important }`. Without layout,
    // JSDOM's 0x0 bounding rects make axe-core's is-on-screen check treat every <marquee> as clipped.
    if (document.querySelector('marquee')) {
        const getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
        dom.window.getComputedStyle = (element: Element, pseudo?: string | null) => {
            const style = getComputedStyle(element, pseudo);
            if (element.localName !== 'marquee') return style;
            return new Proxy(style, {
                get(target, prop) {
                    if (prop === 'overflow' || prop === 'overflowX' || prop === 'overflowY') return 'visible';
                    if (prop === 'getPropertyValue') {
                        return (name: string) => /^overflow(-[xy])?$/.test(name) ? 'visible' : target.getPropertyValue(name);
                    }
                    const value: unknown = Reflect.get(target, prop, target);
                    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
                }
            });
        };
    }
    try {
        // No timeout of its own: an unfinished axe run would overlap the next one. The analysis worker's deadline ends it
        const results = await axe.run(document.documentElement, AXE_OPTIONS);
        return withOwnRules(toFindings(text, dom, results.violations), {
            text: Boolean(document.body?.textContent?.trim()),
            elements: sourceElements(dom),
            // Without stylesheets or scripts nothing but inline styles changes the browser's default styles
            userAgentStylesOnly: !document.querySelector('style, link[rel~="stylesheet" i], script'),
            stylesheetColors: [...document.querySelectorAll('style')].some(style => cssSetsColors(style.textContent ?? ''))
        });
    } finally {
        dom.window.close();
    }
}

function toFindings(text: string, dom: JSDOM, violations: axe.Result[]): Finding[] {
    const findings: Finding[] = [];
    for (const violation of violations) {
        const criteria = criteriaOf(violation);
        if (criteria.length === 0) continue;
        for (const node of violation.nodes) {
            findings.push({
                range: locate(text, dom, node),
                criteria,
                ruleId: violation.id,
                layer: 'check',
                severity: 'warning',
                message: violation.help,
                explanation: [violation.description, node.failureSummary].filter(Boolean).join('\n\n'),
                helpUrl: violation.helpUrl
            });
        }
    }
    return findings;
}

// axe tags criteria as "wcag111" or "wcag1410"; the rule-id table picks the primary one
function criteriaOf(violation: axe.Result): string[] {
    const tagged = violation.tags
        .map(tag => /^wcag(\d)(\d)(\d{1,2})$/.exec(tag))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(([, principle, guideline, criterion]) => `${principle}.${guideline}.${criterion}`)
        .filter(isTargetCriterion);
    const primary = normalizeRuleId(violation.id);
    return tagged.includes(primary) ? [primary, ...tagged.filter(c => c !== primary)] : tagged;
}

// Elements the parser implied have no tag in the source and no attributes, so they are left out; their
// children's parent is the nearest element in the source
function sourceElements(dom: JSDOM): SourceElement[] {
    const { Node } = dom.window;
    const elements = new Map<Element, SourceElement>();
    for (const element of dom.window.document.querySelectorAll('*')) {
        const location = dom.nodeLocation(element) as ElementLocation | null;
        if (!location) continue;
        const tag = location.startTag ?? location;
        let parent: SourceElement | undefined;
        for (let ancestor = element.parentElement; ancestor && !parent; ancestor = ancestor.parentElement) parent = elements.get(ancestor);
        const source: SourceElement = {
            tag: element.localName,
            attributes: new Map([...element.attributes].map(attribute => [attribute.name, attribute.value])),
            range: { start: tag.startOffset, end: tag.endOffset },
            parent
        };
        for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) addText(source, child.textContent ?? '');
        elements.set(element, source);
    }
    return [...elements.values()];
}

// The start tag of the element; elements the parser implied (no tag in the source) fall back to the first line
function locate(text: string, dom: JSDOM, node: axe.NodeResult): TextRange {
    const location = node.element ? dom.nodeLocation(node.element) as ElementLocation | null : null;
    if (location) {
        const tag = location.startTag ?? location;
        return { start: tag.startOffset, end: tag.endOffset };
    }
    const lineEnd = text.indexOf('\n');
    return { start: 0, end: lineEnd === -1 ? text.length : lineEnd };
}
