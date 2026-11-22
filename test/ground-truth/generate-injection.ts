/**
 * Regenerates test/ground-truth/injection: real component files from open-source projects, each with one known
 * failure inserted, so every rule meets enough labelled failures to prove its precision (#78).
 *   for each source below: git clone <url> <dir>/<name> && git -C <dir>/<name> checkout <commit>
 *   npx ts-node test/ground-truth/generate-injection.ts <dir>
 *
 * A base file is a file the Check reports nothing in. Each mutation rewrites one line and keeps the line count,
 * and makes a failure that holds whatever the rest of the file does, so the case expects the mutation's criteria on
 * that line and on no other line. At most PER_KIND cases per language and mutation are evenly spaced over the
 * sorted candidates, preferring distinct source files when enough are available.
 */
import '../esm-only-packages';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import type { GroundTruthCase, GroundTruthSet } from './ground-truth';
import { vueIframeCases } from './vue-iframe-injection';

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
    'mantine': { url: 'https://github.com/mantinedev/mantine', commit: '06e603112455d5073603f33abc2a7cbdf094be2e' },
    'reactstrap': { url: 'https://github.com/reactstrap/reactstrap', commit: '090bc1eeb19bcc269970151d330c6bc03f731635' },
    'astro': { url: 'https://github.com/withastro/astro', commit: 'c302892e4a2434fb4d8e66702576f5406e63d986' },
    'angular': { url: 'https://github.com/angular/angular', commit: '8b15295e8c7f1543d41dadb5955279702be52c16' },
    'ngx-admin': { url: 'https://github.com/akveo/ngx-admin', commit: 'dc6a442704bfef34b776b5eb15faf852d9e2f75c' },
    'css-examples': { url: 'https://github.com/mdn/css-examples', commit: '65b08d2236b304d50d28a807a48c35f6889d902d' },
    'coreui-angular': { url: 'https://github.com/coreui/coreui-free-angular-admin-template', commit: '502fddc3f410daa628a2d4a557797e50784f55e0' },
    'react-big-calendar': { url: 'https://github.com/jquense/react-big-calendar', commit: '183783ad45c8b845c2f57c46711c1c4c85047843' },
    'react-dev': { url: 'https://github.com/reactjs/react.dev', commit: '46a54e0592729712b7640308b53268e84fdc7c9f' },
    'aria-practices': { url: 'https://github.com/w3c/aria-practices', commit: 'f14b2490a6728cda85fd7feafbd148b3c3eaf038' },
    'chrome-samples': { url: 'https://github.com/GoogleChrome/samples', commit: '228e6e56581105bb55cab0d9ff6212d408ccc7dd' },
    'primeng': { url: 'https://github.com/primefaces/primeng', commit: 'fe82b291d6fedde177dc12c0af7ef1008dc1b1ff' },
    'gatsby': { url: 'https://github.com/gatsbyjs/gatsby', commit: '0ac6c88a72c4dfd4d541e3ac43c664343e8e15b6' },
    'nextjs': { url: 'https://github.com/vercel/next.js', commit: '794836c3cbb750d1e34f99e210b39b7bdfbc4c58' },
    'vue-docs': { url: 'https://github.com/vuejs/docs', commit: 'f66b5825d64a722ea6abc6eaae9974aa09c0c109' },
    'hoppscotch': { url: 'https://github.com/hoppscotch/hoppscotch', commit: '55908a76a1d0555c9bbb5d74244c14173df95b06' },
    'dashy': { url: 'https://github.com/Lissy93/dashy', commit: '1ff6f439b09a621c1eca4b8f9d50455cd557d2d7' },
    'material-lite': { url: 'https://github.com/google/material-design-lite', commit: '85f29d30e64827d7a22d193eefe896fa952488f7' },
    'twbs-examples': { url: 'https://github.com/twbs/examples', commit: '897eca7a8331fcca5e3db52ac392ee537ad43b35' },
    'dom-examples': { url: 'https://github.com/mdn/dom-examples', commit: 'a2c57197c219bd1c87d48aa901f4c2a24b249658' },
    'web-dev-beginners': { url: 'https://github.com/microsoft/Web-Dev-For-Beginners', commit: '93b9967af14efd43246c713217dad40d7c27c2f5' }
};

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
    }
];

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
        for (const document of documentsOf(source, clone)) {
            const { languageId, text } = document;
            if (Buffer.byteLength(text) > MAX_FIXTURE_BYTES) continue;
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
        const unique = new Map(samples.map(sample => [sample.file + '\0' + sample.source, sample]));
        const selected = unique.size >= PER_KIND ? [...unique.values()] : samples;
        for (const { source, file, origin, text, editLine, reportLine, mutated } of evenly(selected, PER_KIND)) {
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
