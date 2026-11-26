/**
 * Regenerates test/ground-truth/injection: real component files from open-source projects, each with one known
 * failure inserted, so every rule meets enough labelled failures to prove its precision (#78).
 *   for each source below: git clone <url> <dir>/<name> && git -C <dir>/<name> checkout <commit>
 *   npx ts-node test/ground-truth/generate-injection.ts <dir>
 *
 * A base file is a file the Check reports nothing in. Each mutation rewrites one line and keeps the line count,
 * and makes a failure that holds whatever the rest of the file does, so the case expects the mutation's criteria on
 * that line and on no other line. At most PER_KIND cases per language and mutation are evenly spaced over the
 * sorted candidates, preferring distinct source content when enough is available. Identical mutations count once.
 */
import '../esm-only-packages';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import type { GroundTruthCase, GroundTruthSet } from './ground-truth';
import { SOURCES } from './injection-sources';
import { vueIframeCases } from './vue-iframe-injection';

const PER_KIND = 80;
const MAX_FIXTURE_BYTES = 128 * 1024;

const LANGUAGE: [RegExp, string][] = [
    [/\.tsx$/, 'typescriptreact'],
    [/\.jsx$/, 'javascriptreact'],
    [/^components\/doc\/.*\.js$/, 'javascriptreact'],
    [/^docs\/data\/.*\.js$/, 'javascriptreact'],
    [/\.vue$/, 'vue'],
    [/\.svelte$/, 'svelte'],
    [/\.astro$/, 'astro'],
    [/\.component\.html$/, 'angular'],
    [/-example\.html$/, 'angular'],
    [/\.html$/, 'html']
];

// Attributes that name an element or take it out of the accessibility tree, and spreads that may set them
const NAMED_EXCEPT_TITLE = /\s(aria-label|aria-labelledby|aria-hidden|role|inert)\s*=|\s(?:hidden|inert)(?=[\s=>/])|\b(?:display\s*:\s*['"]?none|visibility\s*:\s*['"]?hidden)\b|\{\s*\.\.\.|v-bind="|v-bind=\{/i;
const TITLE = /\stitle\s*=/i;

function canMutateName(tag: string): boolean {
    return !TITLE.test(tag) && !NAMED_EXCEPT_TITLE.test(tag);
}

interface MutationResult {
    /** Line index (0-based) to replace. */
    editLine: number;
    /** Replacement text for `editLine`. */
    mutated: string;
    /** 0-based line where the failure is reported (defaults to the starting line). */
    reportLine?: number;
}

interface Mutation {
    kind: string;
    criteria: string[];
    languages?: string[];
    /** Returns a single-line edit preserving line count, or undefined when the mutation does not apply. */
    apply(lines: string[], index: number, markup: boolean[], languageId: string): MutationResult | undefined;
}

const MUTATIONS: Mutation[] = [
    {
        // An image without a text alternative (F65)
        kind: 'img-without-alt',
        criteria: ['1.1.1'],
        apply: (lines, i) => {
            const line = lines[i];
            const tag = /<img\b[^<>]*>/.exec(line)?.[0];
            if (tag) {
                if (!canMutateName(tag)) return undefined;
                const stripped = tag.replace(/\s(?::|v-bind:)?alt=("[^"]*"|'[^']*'|\{[^{}]*\})/, '');
                return stripped === tag || /\balt\b/.test(stripped) ? undefined : { editLine: i, mutated: line.replace(tag, stripped) };
            }
            // Multiline <img ... alt="..." ...>
            if (!/<img\b(?![^<>]*>)/.test(line)) return undefined;
            const end = findTagEnd(lines, i);
            if (end === undefined) return undefined;
            const full = lines.slice(i, end + 1).join('\n');
            if (!canMutateName(full)) return undefined;
            for (let k = i; k <= end; k++) {
                const stripped = lines[k].replace(/\s(?::|v-bind:)?alt=("[^"]*"|'[^']*'|\{[^{}]*\})/, '');
                if (stripped !== lines[k] && !/\balt\b/.test(stripped)) {
                    return { editLine: k, mutated: stripped, reportLine: i };
                }
            }
            return undefined;
        }
    },
    {
        // A link without an accessible name (ACT c487ae)
        kind: 'empty-link',
        criteria: ['2.4.4', '4.1.2'],
        apply: (lines, i, markup) => emptied(lines, i, markup, 'a', /\s(:|v-bind:)?href=/)
    },
    {
        // A button without an accessible name (ACT 97a4e1)
        kind: 'empty-button',
        criteria: ['4.1.2'],
        languages: ['html', 'typescriptreact', 'javascriptreact', 'svelte', 'astro', 'angular'],
        apply: (lines, i, markup) => emptied(lines, i, markup, 'button')
    },
    {
        // A text field whose only explicit label was linked through its id (ACT e086e5).
        kind: 'unlabelled-input',
        criteria: ['4.1.2'],
        languages: ['html', 'angular'],
        apply: (lines, i) => {
            const input = /<input\b[^<>]*>/i.exec(lines[i])?.[0];
            if (!input || !canMutateName(input) || /\b(?:placeholder|list)\s*=|\{\{|\[|\]/.test(input)) return undefined;
            const id = /\sid=(["'])([\w-]+)\1/.exec(input)?.[2];
            if (!id || /\stype\s*=/i.test(input) && !/\stype\s*=\s*(["'])(?:text|email|search|tel|url|password)\1/i.test(input)) return undefined;
            const content = lines.join('\n');
            const target = new RegExp(`<label\\b[^<>]*\\sfor=(["'])${id}\\1[^<>]*>[^<>]*\\w[^<>]*</label>`, 'i');
            if (!target.test(content) || content.includes('allyproof-unlabelled') || inLabel(lines, i, '<input')) return undefined;
            return { editLine: i, mutated: lines[i].replace(input, input.replace(/(\sid=)(["'])[\w-]+\2/, '$1$2allyproof-unlabelled$2')) };
        }
    },
    {
        // A full page whose document language was removed (ACT b5c3f8).
        kind: 'html-without-lang',
        criteria: ['3.1.1'],
        languages: ['html'],
        apply: (lines, i) => {
            const html = /^\s*<html\b[^<>]*>/i.exec(lines[i])?.[0];
            if (!html || /\bxml:lang\s*=|\{\{|%\w/.test(html)) return undefined;
            if (!lines.some(line => /^\s*<!doctype\s+html\b/i.test(line))
                || !lines.some(line => /<head\b/i.test(line)) || !lines.some(line => /<body\b/i.test(line))) return undefined;
            const stripped = html.replace(/\slang\s*=\s*(?:"[a-zA-Z-]+"|'[a-zA-Z-]+'|[a-zA-Z-]+(?=[\s>]))/i, '');
            return stripped === html ? undefined : { editLine: i, mutated: lines[i].replace(html, stripped) };
        }
    },
    {
        // An iframe without an accessible name (ACT cae760)
        kind: 'iframe-without-title',
        criteria: ['4.1.2'],
        // Vue cases are selected separately from pinned sources by vueIframeCases.
        languages: ['html', 'typescriptreact', 'javascriptreact', 'svelte', 'astro', 'angular'],
        apply: (lines, i) => {
            const line = lines[i];
            if (!/<iframe\b/.test(line)) return undefined;
            const end = line.includes('>') ? i : findTagEnd(lines, i);
            if (end === undefined) return undefined;
            const tag = /<iframe\b[^<>]*>/.exec(lines.slice(i, end + 1).join('\n'))?.[0];
            if (!tag || NAMED_EXCEPT_TITLE.test(tag)) return undefined;
            const title = /\s(?::|v-bind:)?title=("[^"]+"|'[^']+')/.exec(tag)?.[0];
            if (!title || title.includes('\n') || /\btitle\b/.test(tag.replace(title, ''))) return undefined;
            for (let line = i; line <= end; line++) {
                if (lines[line].includes(title)) return { editLine: line, mutated: lines[line].replace(title, ''), reportLine: i };
            }
            return undefined;
        }
    },
    {
        // An HTML page with an empty <title> (ACT 2779a5); axe reports document-title on the <html> element
        kind: 'empty-title',
        criteria: ['2.4.2'],
        languages: ['html'],
        apply: (lines, i) => {
            const match = /(<title>)([^<>]*\w[^<>]*)(<\/title>)/i.exec(lines[i]);
            if (!match) return undefined;
            const htmlLine = lines.findIndex(l => /<html\b/i.test(l));
            if (htmlLine === -1 || lines.some(l => /%sveltekit\.|\{\{/.test(l))) return undefined;
            return { editLine: i, mutated: lines[i].replace(match[0], match[1] + match[3]), reportLine: htmlLine };
        }
    },
    {
        // aria-hidden="true" on <body> hides the entire page from assistive technology (4.1.2 / 1.3.1)
        kind: 'aria-hidden-body',
        criteria: ['4.1.2', '1.3.1'],
        languages: ['html'],
        apply: (lines, i) => {
            if (lines.some(l => /%sveltekit\.|\{\{/.test(l))) return undefined;
            if (lines.filter(l => /<body\b/i.test(l)).length !== 1) return undefined;
            const match = /<body(\b[^<>]*)>/i.exec(lines[i]);
            if (!match || /aria-hidden/i.test(match[1])) return undefined;
            return { editLine: i, mutated: lines[i].replace(match[0], `<body aria-hidden="true"${match[1]}>`) };
        }
    },
    {
        // A heading without discernible text (2.4.6 / 1.3.1)
        kind: 'empty-heading',
        criteria: ['2.4.6', '1.3.1'],
        languages: ['javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro'],
        apply: (lines, i, markup) => {
            for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
                const result = emptied(lines, i, markup, level);
                if (result) return result;
            }
            return undefined;
        }
    },
    {
        // A non-existent ARIA attribute name (4.1.2)
        kind: 'invalid-aria-prop',
        criteria: ['4.1.2'],
        languages: ['html', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'div|section|p|span', 'aria-labeledby="title"', tag => !/\baria-|\brole\b/i.test(tag))
    },
    {
        // A role attribute whose value is not a valid WAI-ARIA role (4.1.2)
        kind: 'invalid-aria-role',
        criteria: ['4.1.2'],
        languages: ['javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'div|section', 'role="datepicker"', tag => !/\baria-|\brole\b|\bon[A-Z]|@|\(/i.test(tag))
    },
    {
        // An ARIA attribute with an invalid token value (4.1.2)
        kind: 'invalid-aria-value',
        criteria: ['4.1.2'],
        languages: ['javascriptreact', 'typescriptreact', 'svelte', 'astro'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'div|section|p|span', 'aria-live="loud"', tag => !/\baria-|\brole\b/i.test(tag))
    },
    {
        // An explicit checkbox role without its required aria-checked state (4.1.2)
        kind: 'missing-required-aria',
        criteria: ['4.1.2'],
        languages: ['javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'angular'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'div|section|span', 'role="checkbox"',
            tag => !/\baria-|\brole\b|\btabindex\b|\bon[A-Z]|@|\(/i.test(tag))
    },
    {
        // An ARIA state that the element's implicit role does not support (4.1.2)
        kind: 'unsupported-aria-prop',
        criteria: ['4.1.2'],
        languages: ['html', 'javascriptreact', 'typescriptreact', 'svelte', 'astro'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'a', 'aria-checked="true"',
            tag => /\s(?::|v-bind:)?href=/.test(tag) && !/\baria-|\brole\b/i.test(tag))
    },
    {
        // A positive tabindex disrupts the focus order (2.4.3)
        kind: 'positive-tabindex',
        criteria: ['2.4.3'],
        languages: ['javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'angular'],
        apply: (lines, i, _markup, languageId) => {
            const attr = languageId === 'javascriptreact' || languageId === 'typescriptreact' ? 'tabIndex={1}' : 'tabindex="1"';
            return insertAttr(lines, i, languageId, 'button|a', attr,
                tag => !/\btabindex\b|\bdisabled\b/i.test(tag) && (!/^<a\b/.test(tag) || /\s(?::|v-bind:)?href=/.test(tag)));
        }
    },
    {
        // aria-hidden="true" on a focusable control hides a tab stop from assistive technology (ACT 6cfa84, 4.1.2)
        kind: 'aria-hidden-focusable',
        criteria: ['4.1.2'],
        languages: ['javascriptreact', 'typescriptreact', 'vue', 'astro'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'button|a', 'aria-hidden="true"',
            tag => !/\btabindex\b|\bdisabled\b|\baria-hidden\b/i.test(tag) && (!/^<a\b/.test(tag) || /\s(?::|v-bind:)?href=/.test(tag)))
    },
    {
        // An invalid HTML autofill token on a text input (ACT 73f2c2, 1.3.5)
        kind: 'invalid-autocomplete',
        criteria: ['1.3.5'],
        languages: ['html', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'angular'],
        apply: (lines, i, _markup, languageId) => {
            const attr = languageId === 'javascriptreact' || languageId === 'typescriptreact' ? 'autoComplete="emal"' : 'autocomplete="emal"';
            return insertAttr(lines, i, languageId, 'input', attr, tag =>
                !/\bautocomplete\b|\bdisabled\b|\breadonly\b/i.test(tag)
                && (!/\stype\s*=/i.test(tag) || /\stype\s*=\s*(["'])(?:text|email|search|tel|url|password)\1/i.test(tag)));
        }
    },
    {
        // A full HTML page whose lang attribute is not a valid BCP 47 language tag (ACT bf051a, 3.1.1)
        kind: 'invalid-html-lang',
        criteria: ['3.1.1'],
        languages: ['html'],
        apply: (lines, i) => {
            const html = /^\s*<html\b[^<>]*>/i.exec(lines[i])?.[0];
            if (!html || /\bxml:lang\s*=|\{\{|%\w/.test(html)) return undefined;
            if (!lines.some(line => /^\s*<!doctype\s+html\b/i.test(line))
                || !lines.some(line => /<head\b/i.test(line)) || !lines.some(line => /<body\b/i.test(line))) return undefined;
            const replaced = html.replace(/(\slang\s*=\s*)(?:"[a-zA-Z-]+"|'[a-zA-Z-]+'|[a-zA-Z-]+(?=[\s>]))/i, '$1"invalid-lang-xyz"');
            return replaced === html ? undefined : { editLine: i, mutated: lines[i].replace(html, replaced) };
        }
    },
    {
        // An element with an invalid BCP 47 lang attribute (ACT de46e4, 3.1.2)
        kind: 'invalid-lang-attr',
        criteria: ['3.1.2'],
        languages: ['html'],
        apply: (lines, i, _markup, languageId) => insertAttr(lines, i, languageId, 'p|span', 'lang="invalid-lang-xyz"',
            tag => !/\blang\s*=|\bxml:lang\s*=/i.test(tag))
    },
    {
        // A label with text whose for/htmlFor association was removed and that wraps no control (1.3.1 / 4.1.2)
        kind: 'unassociated-label',
        criteria: ['1.3.1', '4.1.2'],
        languages: ['javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'angular'],
        apply: (lines, i, _markup, languageId) => {
            const line = lines[i];
            const tag = /<label\b(?:[^<>{}]|\{[^{}]*\})*>/.exec(line)?.[0];
            if (!tag || !canMutateName(tag)) return undefined;
            const prefix = line.slice(0, line.indexOf(tag));
            if (inQuotes(prefix)) return undefined;
            const forAttr = /\s(?::|v-bind:)?(?:htmlFor|for)=(?:"([^"]+)"|'([^']+)'|\{([^{}]+)\})/.exec(tag);
            if (!forAttr) return undefined;
            const closeIdx = lines.slice(i, Math.min(lines.length, i + 6)).findIndex(l => /<\/label>/.test(l));
            if (closeIdx === -1) return undefined;
            const block = lines.slice(i, i + closeIdx + 1).join('\n');
            const body = block.slice(block.indexOf(tag) + tag.length, block.indexOf('</label>'));
            if (!/\w/.test(body) || /<(?:input|select|textarea|button|meter|output|progress|[A-Z][\w.]*)\b/.test(body)) return undefined;
            const id = forAttr[1] ?? forAttr[2];
            if (languageId === 'vue' && id && new RegExp(`<(?:input|select|textarea)\\b[^<>]*\\sid=(["'])${id}\\1`, 'i').test(lines.join('\n'))) return undefined;
            const stripped = tag.replace(forAttr[0], '');
            return stripped === tag ? undefined : { editLine: i, mutated: line.replace(tag, stripped) };
        }
    }
];

function inQuotes(prefix: string): boolean {
    return ((prefix.match(/"/g)?.length ?? 0) % 2 !== 0) || ((prefix.match(/'/g)?.length ?? 0) % 2 !== 0);
}

function insertAttr(
    lines: string[],
    i: number,
    languageId: string,
    elements: string,
    attr: string,
    allowed: (tag: string) => boolean
): MutationResult | undefined {
    const line = lines[i];
    if (languageId === 'html') {
        if (lines.some(l => /%sveltekit\.|\{\{/.test(l))) return undefined;
        const bodyLine = lines.findIndex(l => /<body\b/i.test(l));
        if (bodyLine === -1 || i <= bodyLine) return undefined;
    }
    const single = new RegExp(`(<(?:${elements}))(\\b[^<>]*>)`).exec(line);
    if (single) {
        if (inQuotes(line.slice(0, single.index))) return undefined;
        const tag = single[0];
        if (!canMutateName(tag) || !allowed(tag) || /\{\{/.test(tag)) return undefined;
        return { editLine: i, mutated: line.replace(tag, `${single[1]} ${attr}${single[2]}`) };
    }
    const open = new RegExp(`(<(?:${elements}))(\\b[^<>]*)$`).exec(line);
    if (!open || inQuotes(line.slice(0, open.index))) return undefined;
    const end = findTagEnd(lines, i);
    if (end === undefined) return undefined;
    const full = lines.slice(i, end + 1).join('\n');
    const tag = new RegExp(`<(?:${elements})\\b[^<>]*>`).exec(full)?.[0];
    if (!tag || !canMutateName(tag) || !allowed(tag) || /\{\{/.test(tag)) return undefined;
    return { editLine: i, mutated: line.replace(open[0], `${open[1]} ${attr}${open[2]}`) };
}

function findTagEnd(lines: string[], start: number): number | undefined {
    const limit = Math.min(lines.length - 1, start + 24);
    for (let k = start + 1; k <= limit; k++) {
        if (lines[k].includes('>')) return k;
    }
    return undefined;
}

function inLabel(lines: string[], i: number, opening: string): boolean {
    const before = [...lines.slice(0, i), lines[i].slice(0, lines[i].toLowerCase().indexOf(opening))].join('\n');
    return (before.match(/<\/?label\b/gi)?.pop() ?? '').toLowerCase() === '<label';
}

function canEmpty(tag: string, lines: string[], i: number, element: string, required?: RegExp): boolean {
    if (!canMutateName(tag) || (required && !required.test(tag))) return false;
    if (element !== 'button') return true;
    const id = /\sid=(["'])([\w-]+)\1/.exec(tag)?.[2];
    if (id && lines.some(line => new RegExp(`\\s(?:htmlFor|for)=(["'])${id}\\1`, 'i').test(line))) return false;
    return !inLabel(lines, i, '<button');
}

// Only plain text or a standalone line of plain text can be removed without assuming how an expression renders.
function emptied(lines: string[], i: number, markup: boolean[], element: string, required?: RegExp): MutationResult | undefined {
    const line = lines[i];
    if (!line.includes(`<${element}`)) return undefined;
    const opening = `<${element}\\b(?:[^<>{}]|\\{[^{}]*\\})*>`;
    const match = new RegExp(`(${opening})([^<>{}]*\\w[^<>{}]*)(</${element}>)`).exec(line);
    if (match) {
        if (!canEmpty(match[1], lines, i, element, required)) return undefined;
        return { editLine: i, mutated: line.replace(match[0], match[1] + match[3]) };
    }
    const openTag = new RegExp(`^\\s*(${opening})\\s*$`);
    const end = openTag.test(line) ? i : findTagEnd(lines, i);
    if (end === undefined || end + 2 >= lines.length || markup.slice(i, end + 3).some(allowed => !allowed)) return undefined;
    const open = openTag.exec(lines.slice(i, end + 1).join('\n'));
    const body = lines[end + 1];
    const close = new RegExp(`^\\s*</${element}>\\s*$`).exec(lines[end + 2]);
    if (!open || !close || !canEmpty(open[1], lines, i, element, required)) return undefined;
    if (!/^[^<>{}]*\w[^<>{}]*$/.test(body)) return undefined;
    return { editLine: end + 1, mutated: '', reportLine: i };
}

async function main(sourcesDir: string) {
    const outDir = path.join(__dirname, 'injection');
    const vueIframes = await vueIframeCases(sourcesDir);
    const candidates = new Map<string, (EvidenceDocument & { source: string; editLine: number; reportLine: number; mutated: string })[]>();
    for (const [source, { commit }] of Object.entries(SOURCES)) {
        const clone = path.join(sourcesDir, source);
        const head = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
        if (head !== commit) throw new Error(`${source} is at ${head}, not ${commit}`);
        if (execFileSync('git', ['-C', clone, 'status', '--porcelain', '--untracked-files=no']).length) {
            throw new Error(`${source} has tracked changes relative to ${commit}`);
        }
        for (const document of documentsOf(source, clone)) {
            const { languageId, text } = document;
            if (Buffer.byteLength(text) > MAX_FIXTURE_BYTES) continue;
            const lines = text.split('\n');
            const markup = markupLines(languageId, lines);
            const applicable = MUTATIONS.flatMap(mutation => {
                if (mutation.languages && !mutation.languages.includes(languageId)) return [];
                return lines.flatMap((_, i) => {
                    const result = markup[i] ? mutation.apply(lines, i, markup, languageId) : undefined;
                    return result === undefined ? [] : [{ mutation, editLine: result.editLine, reportLine: result.reportLine ?? i, mutated: result.mutated }];
                });
            });
            if (applicable.length === 0 || !(await isClean(languageId, text))) continue;
            for (const { mutation, editLine, reportLine, mutated } of applicable) {
                const key = `${languageId} ${mutation.kind}`;
                if (!candidates.has(key)) candidates.set(key, []);
                candidates.get(key)!.push({ ...document, source, editLine, reportLine, mutated });
            }
        }
    }

    const set: GroundTruthSet = {
        source: 'Component files of open-source projects at pinned commits, each with one inserted failure; each case names its source, commit and licence in its note.',
        cases: []
    };
    fs.rmSync(outDir, { recursive: true, force: true });
    for (const key of [...candidates.keys()].sort()) {
        const [languageId, kind] = key.split(' ');
        const mutation = MUTATIONS.find(m => m.kind === kind)!;
        const samples = candidates.get(key)!;
        const unique = new Map(samples.map(sample => [sample.text, sample]));
        const selected = unique.size >= PER_KIND ? [...unique.values()]
            : [...new Map(samples.map(sample => [`${sample.text}\0${sample.editLine}\0${sample.mutated}`, sample])).values()];
        const written = new Set<string>();
        for (const { source, file, origin, text, editLine, reportLine, mutated } of evenly(selected, PER_KIND)) {
            const lines = text.split('\n');
            lines[editLine] = mutated;
            const mutatedText = lines.join('\n').replace(/AIza[0-9A-Za-z_-]{35}/g, 'REDACTED_API_KEY');
            if (written.has(mutatedText)) continue;
            written.add(mutatedText);
            const ext = languageId === 'javascriptreact' ? '.jsx' : path.extname(file);
            const caseFile = path.join(kind, source, `${file.replace(/[\\/]/g, '__')}--${reportLine + 1}${ext}`);
            fs.mkdirSync(path.dirname(path.join(outDir, caseFile)), { recursive: true });
            fs.writeFileSync(path.join(outDir, caseFile), mutatedText);
            const licence = path.join(outDir, 'licenses', source);
            if (!fs.existsSync(licence)) copyLicence(path.join(sourcesDir, source), licence);
            const { url, commit } = SOURCES[source];
            const testCase: GroundTruthCase = {
                file: caseFile.split(path.sep).join('/'),
                languageId,
                note: origin
                    ? `${url}/blob/${commit}/${origin} (licence in licenses/${source}), ${kind} inserted on fixture line ${reportLine + 1}.`
                    : `${url}/blob/${commit}/${file} (licence in licenses/${source}), ${kind} inserted on line ${reportLine + 1}.`,
                expect: mutation.criteria.map(criterion => ({ criterion, line: reportLine + 1 }))
            };
            set.cases.push(testCase);
        }
    }
    for (const { testCase, text, licenceFile, licence } of vueIframes) {
        const file = path.join(outDir, testCase.file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        fs.writeFileSync(path.join(outDir, licenceFile), licence);
        set.cases.push(testCase);
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Generated ${set.cases.length} cases`);
}

interface EvidenceDocument {
    languageId: string;
    file: string;
    origin?: string;
    text: string;
}

function* documentsOf(source: string, clone: string): Iterable<EvidenceDocument> {
    const seen = new Set<string>();
    for (const file of filesOf(clone)) {
        const reactExample = source === 'react-dev' && /^src\/content\/.*\.md$/.test(file);
        const angularExample = source === 'primeng' && file.includes('showcase') && file.endsWith('.ts');
        if (reactExample || angularExample) {
            const text = fs.readFileSync(path.join(clone, file), 'utf8');
            const examples = reactExample
                ? text.matchAll(/^```(?:js|jsx)\b[^\n]*\n([\s\S]*?)^```/gm)
                : text.matchAll(/\btemplate\s*:\s*`([^`]+)`/g);
            for (const example of examples) {
                const template = example[1];
                if (!/<(?:a|button|img|label|iframe)\b/.test(template) || template.includes('${') || seen.has(template.trim())) continue;
                seen.add(template.trim());
                const line = text.slice(0, example.index).split('\n').length;
                yield {
                    languageId: reactExample ? 'javascriptreact' : 'angular',
                    file: `${file}--${line}${reactExample ? '.jsx' : '.component.html'}`,
                    origin: `${file}#L${line}`,
                    text: template
                };
            }
            continue;
        }
        if (['gatsby', 'nextjs'].includes(source) && (!file.startsWith('examples/') || /\/(?:cms-sitecore-xmcloud|with-stencil)\//.test(file))) continue;
        const javascriptComponent = ['reactstrap', 'react-big-calendar'].includes(source) && /^(src|stories)\/.*\.js$/.test(file)
            || ['gatsby', 'nextjs'].includes(source) && file.endsWith('.js');
        const angularTemplate = ['angular', 'coreui-angular'].includes(source) && /\.html$/.test(file);
        const languageId = javascriptComponent ? 'javascriptreact'
            : angularTemplate ? 'angular' : LANGUAGE.find(([pattern]) => pattern.test(file))?.[1];
        if (languageId) yield { languageId, file, text: fs.readFileSync(path.join(clone, file), 'utf8') };
    }
}

// Which lines are rendered markup: not script, style, frontmatter, comments or markup quoted in a template literal
// (a code sample). shortcut: line-based, so a line that opens or closes one of these regions is left out too.
function markupLines(languageId: string, lines: string[]): boolean[] {
    let region: 'markup' | 'script' | 'style' | 'comment' | 'frontmatter' = 'markup';
    let inTemplate = languageId !== 'vue';
    let backticks = 0;
    return lines.map((line, i) => {
        const trimmed = line.trim();
        const before = backticks;
        backticks += (line.match(/(?<!\\)`/g) ?? []).length;
        if (languageId === 'astro' && trimmed === '---' && (i === 0 || region === 'frontmatter')) {
            region = region === 'frontmatter' ? 'markup' : 'frontmatter';
            return false;
        }
        if (languageId === 'vue' && /^<template\b/.test(line)) inTemplate = true;
        if (languageId === 'vue' && /^<\/template>/.test(line)) inTemplate = false;
        if (region === 'markup' && /<script\b/.test(line) && !/<\/script>/.test(line)) region = 'script';
        else if (region === 'markup' && /<style\b/.test(line) && !/<\/style>/.test(line)) region = 'style';
        else if (region === 'markup' && line.includes('<!--') && !line.includes('-->')) region = 'comment';
        else if ((region === 'script' && /<\/script>/.test(line)) || (region === 'style' && /<\/style>/.test(line)) || (region === 'comment' && line.includes('-->'))) {
            region = 'markup';
            return false;
        } else if (region === 'markup') {
            const jsx = languageId === 'typescriptreact' || languageId === 'javascriptreact';
            return inTemplate && before % 2 === 0 && backticks === before && !line.includes('<!--')
                && !(jsx && /^(\/\/|\/\*|\*)/.test(trimmed));
        }
        return false;
    });
}

async function isClean(languageId: string, text: string): Promise<boolean> {
    try {
        const { findings, needsReview } = await analyse({ languageId, text });
        return findings.length === 0 && needsReview.every(entry => !entry.ruleId);
    } catch {
        return false;
    }
}

function filesOf(clone: string): string[] {
    return execFileSync('git', ['-C', clone, 'ls-files'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n')
        .filter(file => file && !/(^|\/)(tests?|__tests__|__e2e__|e2e|fixtures?|dist|build|node_modules)\//.test(file)
            && !/\.(spec|test|stories)\./.test(file)
            && fs.existsSync(path.join(clone, file)))
        .sort();
}

function copyLicence(clone: string, to: string) {
    const name = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-DOCS.md', 'license.md'].find(n => fs.existsSync(path.join(clone, n)));
    if (!name) throw new Error(`${clone} has no licence file`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(clone, name), to);
}

function evenly<T>(items: T[], max: number): T[] {
    if (items.length <= max) return items;
    return Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]);
}

const sources = process.argv[2];
if (!sources) {
    console.error('Usage: npx ts-node test/ground-truth/generate-injection.ts <dir with the sources checked out>');
    process.exit(1);
}
void main(sources);
