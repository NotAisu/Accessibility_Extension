import { criterionName, criterionUrl } from './wcag';
import { ACT_RULES, ENTRIES, type Entry } from './rule-docs-data';

// The rule docs behind the learn hover: per rule id what the problem is, why it matters, how to fix it, a bad and a
// good snippet in the document's framework and the W3C sources. Entries are written once per concept; snippets are
// written once as HTML and translated to each framework's syntax unless the entry overrides them.

export type Framework = 'html' | 'jsx' | 'vue' | 'svelte' | 'angular' | 'astro';
export const FRAMEWORKS: readonly Framework[] = ['html', 'jsx', 'vue', 'svelte', 'angular', 'astro'];

export interface Example {
    /** Code fence language. */
    language: string;
    /** The file the snippet belongs in, when it is not the checked component, such as index.html. */
    file?: string;
    bad: string;
    good: string;
}

export interface Link {
    title: string;
    url: string;
}

export interface RuleDoc {
    message: string;
    why: string;
    fix: string;
    /** The Finding's own explanation carries values only it knows, such as a contrast ratio, and is shown too. */
    details: boolean;
    wcag: (Link & { criterion: string })[];
    act: Link[];
    examples: Record<Framework, Example>;
}

/** The framework of a Check language id (see `checkLanguageId`). */
export function frameworkOf(languageId: string): Framework {
    switch (languageId) {
        case 'javascriptreact':
        case 'typescriptreact': return 'jsx';
        case 'vue': return 'vue';
        case 'svelte': return 'svelte';
        case 'angular':
        case 'typescript': return 'angular';
        case 'astro': return 'astro';
        default: return 'html';
    }
}

const byRule = new Map<string, Entry>();
for (const entry of ENTRIES) {
    for (const rule of entry.rules) {
        if (byRule.has(rule)) throw new Error(`Rule ${rule} has two docs entries`);
        byRule.set(rule, entry);
    }
}

/** The docs entry of a rule id; undefined for a rule without one. */
export function ruleDoc(ruleId: string): RuleDoc | undefined {
    const entry = byRule.get(ruleId);
    if (!entry) return undefined;
    return {
        message: entry.message,
        why: entry.why,
        fix: entry.fix,
        details: entry.details ?? false,
        wcag: entry.wcag.map(criterion => ({ criterion, title: `WCAG ${criterion} ${criterionName(criterion)}`, url: criterionUrl(criterion) })),
        act: (entry.act ?? []).map(id => ({ title: `ACT rule: ${ACT_RULES[id]}`, url: `https://www.w3.org/WAI/standards-guidelines/act/rules/${id}/` })),
        examples: Object.fromEntries(FRAMEWORKS.map(framework => [framework, example(entry, framework)])) as Record<Framework, Example>
    };
}

const LANGUAGE: Record<Framework, string> = { html: 'html', jsx: 'jsx', vue: 'vue', svelte: 'svelte', angular: 'html', astro: 'astro' };

// Where a page-level snippet (html, head, body) lives in frameworks whose components cannot hold it
const DOCUMENT_FILE: Partial<Record<Framework, string>> = { vue: 'index.html', svelte: 'src/app.html', angular: 'src/index.html' };

function example(entry: Entry, framework: Framework): Example {
    const override = entry.overrides?.[framework];
    if (override) return { language: LANGUAGE[framework], ...override };
    const file = entry.document ? DOCUMENT_FILE[framework] : undefined;
    if (file) return { language: 'html', file, ...entry.example };
    const translate = TRANSLATE[framework];
    return { language: LANGUAGE[framework], bad: translate(entry.example.bad), good: translate(entry.example.good) };
}

// Inline handlers in the HTML snippets are written as on<event>="name()"
const HANDLER = /\son([a-z]+)="(\w+)\(\)"/g;

const TRANSLATE: Record<Framework, (html: string) => string> = {
    html: html => html,
    astro: html => html,
    jsx: toJsx,
    vue: html => `<template>\n${html.replace(HANDLER, ' @$1="$2"').replace(/^/gm, '  ')}\n</template>`,
    svelte: html => html.replace(HANDLER, ' on$1={$2}'),
    angular: html => html.replace(HANDLER, ' ($1)="$2()"')
};

const JSX_EVENTS: Record<string, string> = {
    click: 'onClick', keydown: 'onKeyDown', mouseover: 'onMouseOver', mouseout: 'onMouseOut', focus: 'onFocus', blur: 'onBlur'
};
const JSX_ATTRIBUTES: Record<string, string> = {
    'class': 'className', 'for': 'htmlFor', 'tabindex': 'tabIndex', 'srclang': 'srcLang', 'charset': 'charSet',
    'autocomplete': 'autoComplete', 'autoplay': 'autoPlay', 'colspan': 'colSpan', 'usemap': 'useMap', 'http-equiv': 'httpEquiv'
};
const VOID_ELEMENTS = 'area|br|col|embed|hr|img|input|link|meta|source|track|wbr';

function toJsx(html: string): string {
    return html
        .replace(HANDLER, (_, event: string, handler: string) => ` ${JSX_EVENTS[event]}={${handler}}`)
        .replace(/\sstyle="([^"]*)"/g, (_, css: string) => ` style={{ ${styleObject(css)} }}`)
        .replace(/(\s)([a-z-]+)(?=[\s=/>])/g, (match, space: string, name: string) => JSX_ATTRIBUTES[name] ? space + JSX_ATTRIBUTES[name] : match)
        .replace(new RegExp(`<(${VOID_ELEMENTS})\\b([^>]*?)\\s*>`, 'g'), '<$1$2 />');
}

function styleObject(css: string): string {
    return css.split(';').map(declaration => declaration.trim()).filter(Boolean).map(declaration => {
        const [property, ...value] = declaration.split(':');
        const key = property.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        return `${key}: '${value.join(':').trim()}'`;
    }).join(', ');
}
