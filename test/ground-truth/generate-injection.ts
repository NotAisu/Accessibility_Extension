/**
 * Regenerates test/ground-truth/injection: real component files from open-source projects, each with one known
 * failure inserted, so every rule meets enough labelled failures to prove its precision (#78).
 *   for each source below: git clone <url> <dir>/<name> && git -C <dir>/<name> checkout <commit>
 *   npx ts-node test/ground-truth/generate-injection.ts <dir>
 *
 * A base file is a file the Check reports nothing in. Each mutation rewrites one line and keeps the line count,
 * and makes a failure that holds whatever the rest of the file does, so the case expects the mutation's criteria on
 * that line and on no other line. At most PER_KIND cases per language and mutation, evenly spaced over the sorted
 * candidates, keep one project from outweighing the others.
 */
import '../esm-only-packages';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import type { GroundTruthCase, GroundTruthSet } from './ground-truth';

const SOURCES: Record<string, { url: string; commit: string }> = {
    'angular-components': { url: 'https://github.com/angular/components', commit: '5eb7a34a082e5f9736711938972cc2984265f5a9' },
    'element-plus': { url: 'https://github.com/element-plus/element-plus', commit: '7c07ff389d7d39fc59ab8214689bcd90b46a5487' },
    'excalidraw': { url: 'https://github.com/excalidraw/excalidraw', commit: 'd732d4f3d50e6ac092ec6e86a4e04a40546a9395' },
    'shadcn-svelte': { url: 'https://github.com/huntabyte/shadcn-svelte', commit: 'c3b21a62055c7d7b97a220eb5a9efb4d1b7fc8fc' },
    'material-ui': { url: 'https://github.com/mui/material-ui', commit: '422ac96720b78e518581095b6806d958003fdb3f' },
    'nuxt-ui': { url: 'https://github.com/nuxt/ui', commit: '0f58f482b839023ee8f61cc58451c6e371b2a177' },
    'primevue': { url: 'https://github.com/primefaces/primevue', commit: '36965f13dc40597deeb16192a8568308cbeb70d9' },
    'shadcn-ui': { url: 'https://github.com/shadcn-ui/ui', commit: '968d8cb9dc42ae5d52e8fd356cf84596ec832a26' },
    'skeleton': { url: 'https://github.com/skeletonlabs/skeleton', commit: '38f596fabb0b529ae0f7781c7212c00fd4435fc4' },
    'sveltekit': { url: 'https://github.com/sveltejs/kit', commit: '1cda796508aa14efd3b7832f3290a8f04eb88526' },
    'bootstrap': { url: 'https://github.com/twbs/bootstrap', commit: 'cca152095afcf92b9defb5deae8304a2a84f61eb' },
    'astro-docs': { url: 'https://github.com/withastro/docs', commit: '697d16abd26476628cf0bf7b932a8920c768720b' },
    'starlight': { url: 'https://github.com/withastro/starlight', commit: 'dc7451c127bbf1dc195a2c1ab2c3670fc00dd84c' },
    'primereact': { url: 'https://github.com/primefaces/primereact', commit: '5cd9b145ce7d8b498e745002624ba958f307897e' },
    'mdn-learning-area': { url: 'https://github.com/mdn/learning-area', commit: '21973263ba859ff3477919087b488157f9d618a6' },
    'mantine': { url: 'https://github.com/mantinedev/mantine', commit: '06e603112455d5073603f33abc2a7cbdf094be2e' }
};

const PER_KIND = 80;

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
const NAMED = /\s(aria-label|aria-labelledby|title|aria-hidden|role)\s*=|\{\s*\.\.\.|v-bind="|v-bind=\{/;
const NAMED_EXCEPT_TITLE = /\s(aria-label|aria-labelledby|aria-hidden|role)\s*=|\{\s*\.\.\.|v-bind="|v-bind=\{/;

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
    apply(lines: string[], index: number, markup: boolean[]): MutationResult | undefined;
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
                if (NAMED.test(tag)) return undefined;
                const stripped = tag.replace(/\s(?::|v-bind:)?alt=("[^"]*"|'[^']*'|\{[^{}]*\})/, '');
                return stripped === tag || /\balt\b/.test(stripped) ? undefined : { editLine: i, mutated: line.replace(tag, stripped) };
            }
            // Multiline <img ... alt="..." ...>
            if (!/<img\b(?![^<>]*>)/.test(line)) return undefined;
            const end = findTagEnd(lines, i);
            if (end === undefined) return undefined;
            const full = lines.slice(i, end + 1).join('\n');
            if (NAMED.test(full)) return undefined;
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
        // An iframe without an accessible name (ACT cae760)
        kind: 'iframe-without-title',
        criteria: ['4.1.2'],
        apply: (lines, i) => {
            const line = lines[i];
            const tag = /<iframe\b[^<>]*>/.exec(line)?.[0];
            if (!tag || NAMED_EXCEPT_TITLE.test(tag)) return undefined;
            const stripped = tag.replace(/\s(?::|v-bind:)?title=("[^"]*"|'[^']*'|\{[^{}]*\})/, '');
            return stripped === tag || /\btitle\b/.test(stripped) ? undefined : { editLine: i, mutated: line.replace(tag, stripped) };
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
    }
];

function findTagEnd(lines: string[], start: number): number | undefined {
    const limit = Math.min(lines.length - 1, start + 24);
    for (let k = start + 1; k <= limit; k++) {
        if (lines[k].includes('>')) return k;
    }
    return undefined;
}

// The element on one line (or open / plain-text / close across three lines) with plain text as its only content, emptied
function emptied(lines: string[], i: number, markup: boolean[], element: string, required?: RegExp): MutationResult | undefined {
    const line = lines[i];
    const match = new RegExp(`(<${element}\\b(?:[^<>{}]|\\{[^{}]*\\})*>)([^<>{}]*\\w[^<>{}]*)(</${element}>)`).exec(line);
    if (match) {
        if (NAMED.test(match[1]) || (required && !required.test(match[1]))) return undefined;
        return { editLine: i, mutated: line.replace(match[0], match[1] + match[3]) };
    }
    if (i + 2 >= lines.length || !markup[i + 1] || !markup[i + 2]) return undefined;
    const open = new RegExp(`^\\s*(<${element}\\b(?:[^<>{}]|\\{[^{}]*\\})*>)\\s*$`).exec(line);
    const body = lines[i + 1];
    const close = new RegExp(`^\\s*</${element}>\\s*$`).exec(lines[i + 2]);
    if (!open || !close || NAMED.test(open[1]) || (required && !required.test(open[1]))) return undefined;
    if (!/^[^<>{}]*\w[^<>{}]*$/.test(body)) return undefined;
    return { editLine: i + 1, mutated: '', reportLine: i };
}

async function main(sourcesDir: string) {
    const outDir = path.join(__dirname, 'injection');
    fs.rmSync(outDir, { recursive: true, force: true });
    const candidates = new Map<string, { source: string; file: string; text: string; editLine: number; reportLine: number; mutated: string }[]>();
    for (const [source, { commit }] of Object.entries(SOURCES)) {
        const clone = path.join(sourcesDir, source);
        const head = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
        if (head !== commit) throw new Error(`${source} is at ${head}, not ${commit}`);
        for (const file of filesOf(clone)) {
            const languageId = LANGUAGE.find(([pattern]) => pattern.test(file))?.[1];
            if (!languageId) continue;
            const text = fs.readFileSync(path.join(clone, file), 'utf-8');
            const lines = text.split('\n');
            const markup = markupLines(languageId, lines);
            const applicable = MUTATIONS.flatMap(mutation => {
                if (mutation.languages && !mutation.languages.includes(languageId)) return [];
                return lines.flatMap((_, i) => {
                    const result = markup[i] ? mutation.apply(lines, i, markup) : undefined;
                    return result === undefined ? [] : [{ mutation, editLine: result.editLine, reportLine: result.reportLine ?? i, mutated: result.mutated }];
                });
            });
            if (applicable.length === 0 || !(await isClean(languageId, text))) continue;
            for (const { mutation, editLine, reportLine, mutated } of applicable) {
                const key = `${languageId} ${mutation.kind}`;
                if (!candidates.has(key)) candidates.set(key, []);
                candidates.get(key)!.push({ source, file, text, editLine, reportLine, mutated });
            }
        }
    }

    const set: GroundTruthSet = {
        source: 'Component files of open-source projects at pinned commits, each with one inserted failure; each case names its source, commit and licence in its note.',
        cases: []
    };
    for (const key of [...candidates.keys()].sort()) {
        const [languageId, kind] = key.split(' ');
        const mutation = MUTATIONS.find(m => m.kind === kind)!;
        for (const { source, file, text, editLine, reportLine, mutated } of evenly(candidates.get(key)!, PER_KIND)) {
            const lines = text.split('\n');
            lines[editLine] = mutated;
            const ext = languageId === 'javascriptreact' ? '.jsx' : path.extname(file);
            const caseFile = path.join(kind, source, `${file.replace(/[\\/]/g, '__')}--${reportLine + 1}${ext}`);
            fs.mkdirSync(path.dirname(path.join(outDir, caseFile)), { recursive: true });
            fs.writeFileSync(path.join(outDir, caseFile), lines.join('\n'));
            const licence = path.join(outDir, 'licenses', source);
            if (!fs.existsSync(licence)) copyLicence(path.join(sourcesDir, source), licence);
            const { url, commit } = SOURCES[source];
            const testCase: GroundTruthCase = {
                file: caseFile.split(path.sep).join('/'),
                languageId,
                note: `${url}/blob/${commit}/${file} (licence in licenses/${source}), ${kind} inserted on line ${reportLine + 1}.`,
                expect: mutation.criteria.map(criterion => ({ criterion, line: reportLine + 1 }))
            };
            set.cases.push(testCase);
        }
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Generated ${set.cases.length} cases`);
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
        .filter(file => file && !/(^|\/)(tests?|__tests__|__e2e__|e2e|fixtures?)\//.test(file) && !/\.(spec|test|stories)\./.test(file)
            && fs.existsSync(path.join(clone, file)))
        .sort();
}

function copyLicence(clone: string, to: string) {
    const name = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(n => fs.existsSync(path.join(clone, n)));
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
