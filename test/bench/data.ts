/**
 * The AI benchmark's cases: the AccessGuru semantic subset, fetched at bench time because its page HTML
 * belongs to third parties, and synthetic component wrappers of the vendored W3C ACT cases.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { GroundTruthSet } from '../ground-truth/ground-truth';
import type { BenchCase } from './benchmark';

// Pinned, so every run scores the same cases
const ACCESSGURU_COMMIT = 'c85372eee38a0813315040772c9a2342d3f4c74d';
const ACCESSGURU_URL = `https://raw.githubusercontent.com/NadeenAhmad/AccessGuruLLM/${ACCESSGURU_COMMIT}/data/accessguru_dataset/accessguru_sampled_semantic_violations.csv`;

// AccessGuru labels violation types, not criteria. A label that names an unclear label or name fits more than one
// criterion, so any of them counts
const ACCESSGURU_CRITERIA: Record<string, string[]> = {
    'image-alt-not-descriptive': ['1.1.1'],
    'lang-mismatch': ['3.1.1'],
    'missing-lang-tag': ['3.1.2'],
    'link-text-mismatch': ['2.4.4'],
    'form-label-mismatch': ['1.3.1', '2.4.6', '2.5.3', '3.3.2'],
    'ambiguous-heading': ['2.4.6'],
    'page-title-not-descriptive': ['2.4.2'],
    'button-label-mismatch': ['1.1.1', '2.4.4', '2.5.3', '4.1.2']
};
// The dataset marks where each violation starts; the model must not see it
const VIOLATION_MARKER = /<!\s*––\s*Accessibility Violation starts here\s*––>/g;

// ACT rules that need judgment rather than syntax, and whose markup lives in the body so a component can hold it
const ACT_RULES = new Set(['cc0f0a', 'b49b2e', 'qt1vmo', '36b590', '5effbb', 'fd3a94', '9bd38c', '2ee8b8']);
const ACT_DIR = path.join(__dirname, '..', 'ground-truth', 'act');

export async function accessGuruCases(): Promise<BenchCase[]> {
    const response = await fetch(ACCESSGURU_URL);
    if (!response.ok) throw new Error(`Fetching AccessGuru failed: HTTP ${response.status}`);
    return parseAccessGuruCsv(await response.text());
}

export function parseAccessGuruCsv(csv: string): BenchCase[] {
    const [header, ...rows] = parseCsv(csv);
    const column = (name: string) => header.indexOf(name);
    const [id, type, html] = [column('#'), column('Violation Type'), column('Affected HTML')];
    return rows.filter(row => row.length === header.length).map(row => {
        const criteria = ACCESSGURU_CRITERIA[row[type]];
        if (!criteria) throw new Error(`AccessGuru has a violation type without criteria: ${row[type]}`);
        return {
            id: `accessguru-${row[id]}`,
            source: `AccessGuru ${row[type]}`,
            synthetic: false,
            languageId: 'html',
            text: row[html].replace(VIOLATION_MARKER, '').trim(),
            criteria,
            failing: true
        };
    });
}

/** The body of each judgment ACT case, wrapped into a Vue or Svelte component in turn. */
export function actWrapperCases(): BenchCase[] {
    const set = JSON.parse(fs.readFileSync(path.join(ACT_DIR, 'expectations.json'), 'utf-8')) as GroundTruthSet;
    const cases: BenchCase[] = [];
    for (const testCase of set.cases) {
        const rule = /^ACT rule (\S+)/.exec(testCase.note ?? '')?.[1];
        if (!rule || !ACT_RULES.has(rule)) continue;
        const body = bodyOf(fs.readFileSync(path.join(ACT_DIR, testCase.file), 'utf-8'));
        if (body === undefined) continue;
        const vue = cases.length % 2 === 0;
        const markup = indent(body.trimEnd(), vue ? '        ' : '    ');
        cases.push({
            id: `${path.basename(testCase.file, '.html')}${vue ? '.vue' : '.svelte'}`,
            source: `${testCase.note ?? rule}, wrapped`,
            synthetic: true,
            languageId: vue ? 'vue' : 'svelte',
            text: vue ? `<template>\n    <div>\n${markup}\n    </div>\n</template>\n` : `<div class="example">\n${markup}\n</div>\n`,
            criteria: testCase.expect.map(e => e.criterion),
            failing: testCase.expect.some(e => 'present' in e && e.present)
        });
    }
    return cases;
}

// Many ACT examples are an html element without a body
function bodyOf(page: string): string | undefined {
    const content = /<body[^>]*>\n?([\s\S]*?)<\/body>/i.exec(page)?.[1] ?? /<html[^>]*>\n?([\s\S]*?)<\/html>/i.exec(page)?.[1];
    return content?.replace(/<head>[\s\S]*?<\/head>\n?/i, '');
}

function indent(text: string, by: string): string {
    return text.split('\n').map(line => line && by + line).join('\n');
}

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length > 0) rows.push([...row, field]);
    return rows;
}
