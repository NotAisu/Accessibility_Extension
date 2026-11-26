/**
 * Turns a list of pinned source files into labelled field cases, each label agreed by two labellers (ADR 0005).
 *   npm run label:field -- <sources.json> [--labeller "<command>"] [--work <dir>]
 *
 * <sources.json> lists `{ "repo": "owner/name", "commit": "<40 hex>", "file": "path/in/repo", "languageId"? }`.
 * For each file the command fetches the file and the project's licence at the commit, rejects a licence that is not
 * permissive and a text that repeats an evidence case, runs the Check and writes one labeller prompt per labeller:
 *   <work>/first/<id>/prompt.md     <work>/second/<id>/prompt.md
 * Both prompts are written before anyone labels, from the file and the Check's matches only, so the second
 * labeller never receives the first labels. Each labeller answers with labels.json in its own directory: with
 * --labeller the command runs it there for each prompt (the prompt on stdin, the labels on stdout), one fresh
 * process per labeller; without it, run the two labellers yourself and run the command again.
 *
 * Once both labels exist, only the labels both agree on are written to the field set. A criterion one labeller
 * says fails and the other says passes, or whose failing lines differ at a line the Check reported, is a
 * disagreement: the case is reported and stays unlabelled. Close calls (an unsure verdict, a failure only one
 * labeller found where the Check reported nothing) leave that criterion unlabelled.
 */
import '../esm-only-packages';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import type { Expectation, GroundTruthCase, GroundTruthSet } from './ground-truth';
import { SOURCES as INJECTION_SOURCES } from './injection-sources';
import { RuleMatch, repeatedEvidence, ruleMatches } from './proof';

export interface FieldSource {
    repo: string;
    commit: string;
    file: string;
    languageId?: string;
}

/** One labeller's verdict on a criterion over the whole file. */
export interface CriterionLabel {
    criterion: string;
    verdict: 'fails' | 'passes' | 'unsure';
    /** Where it fails, when it fails */
    lines?: number[];
    reason: string;
}

export interface Labels {
    criteria: CriterionLabel[];
}

export interface LabelFieldOptions {
    sources: FieldSource[];
    /** The field set: expectations.json and the case files */
    fieldDir: string;
    /** Where prompts and labels are kept between runs */
    workDir: string;
    /** Every evidence set; a candidate repeating one of their texts is rejected */
    evidenceDirs: string[];
    /** The text at a URL, undefined when there is none */
    fetchText: (url: string) => Promise<string | undefined>;
    /** Runs one labeller in its own directory with its prompt and returns its answer */
    labeller?: (dir: string, prompt: string) => string | Promise<string>;
}

export interface LabelFieldReport {
    written: string[];
    disagreements: string[];
    closeCalls: string[];
    rejected: string[];
    waiting: string[];
    /** Sources from a project the injection set already uses */
    inInjection: string[];
}

const LABELLERS = ['first', 'second'] as const;
const MAX_BYTES = 128 * 1024;
const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'license.md', 'COPYING'];
const PERMISSIVE: [RegExp, string][] = [
    [/Permission is hereby granted, free of charge/i, 'MIT'],
    [/Apache License,?\s+Version 2\.0/i, 'Apache-2.0'],
    [/Redistribution and use in source and binary forms/i, 'BSD'],
    [/Permission to use, copy, modify, and\/or distribute/i, 'ISC'],
    [/This is free and unencumbered software released into the public domain/i, 'Unlicense'],
    [/CC0 1\.0 Universal/i, 'CC0-1.0']
];
const LANGUAGE: [RegExp, string][] = [
    [/\.tsx$/, 'typescriptreact'],
    [/\.jsx$/, 'javascriptreact'],
    [/\.vue$/, 'vue'],
    [/\.svelte$/, 'svelte'],
    [/\.astro$/, 'astro'],
    [/(\.component|-example)\.html$/, 'angular'],
    [/\.html?$/, 'html']
];

interface Candidate {
    source: FieldSource;
    languageId: string;
    caseFile: string;
    licence: string;
    licenceName: string;
    lineCount: number;
    matches: RuleMatch[];
}

export async function labelField(options: LabelFieldOptions): Promise<LabelFieldReport> {
    const report: LabelFieldReport = { written: [], disagreements: [], closeCalls: [], rejected: [], waiting: [], inInjection: [] };
    const expectationsFile = path.join(options.fieldDir, 'expectations.json');
    const field = JSON.parse(fs.readFileSync(expectationsFile, 'utf-8')) as GroundTruthSet;
    const repeated = evidenceTexts(options.evidenceDirs);
    const injectionRepos = new Set(Object.values(INJECTION_SOURCES).map(s => s.url.replace('https://github.com/', '').toLowerCase()));

    for (const source of options.sources) {
        const name = `${source.repo}@${source.commit.slice(0, 7)}:${source.file}`;
        if (!/^[\w.-]+\/[\w.-]+$/.test(source.repo) || !/^[0-9a-f]{40}$/.test(source.commit)) {
            report.rejected.push(`${name}: repo must be owner/name and commit a full 40-character SHA`);
            continue;
        }
        if (injectionRepos.has(source.repo.toLowerCase())) report.inInjection.push(name);
        const caseFile = `${source.repo.replace('/', '_')}/${source.file}`;
        if (field.cases.some(c => c.file === caseFile)) {
            report.rejected.push(`${name}: already in the field set`);
            continue;
        }
        const id = caseFile.replace(/[\\/]/g, '__');
        const candidateFile = path.join(options.workDir, 'candidates', `${id}.json`);
        if (fs.existsSync(candidateFile)) {
            // prepared by an earlier run: its text still counts, so a later repeat of it is rejected
            const prepared = JSON.parse(fs.readFileSync(candidateFile, 'utf-8')) as Candidate;
            repeated(prepared.languageId, `candidate ${caseFile}`, caseText(options.workDir, id, source), undefined);
        } else {
            const problem = await prepare(options, source, caseFile, id, candidateFile, repeated);
            if (problem) {
                report.rejected.push(`${name}: ${problem}`);
                continue;
            }
        }
        const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf-8')) as Candidate;
        const labels: Partial<Record<typeof LABELLERS[number], Labels>> = {};
        for (const labeller of LABELLERS) {
            const dir = path.join(options.workDir, labeller, id);
            const labelsFile = path.join(dir, 'labels.json');
            if (!fs.existsSync(labelsFile) && options.labeller) {
                fs.writeFileSync(labelsFile, JSON.stringify(parseLabels(await options.labeller(dir, fs.readFileSync(path.join(dir, 'prompt.md'), 'utf-8'))), null, 2) + '\n');
            }
            if (fs.existsSync(labelsFile)) labels[labeller] = checkLabels(JSON.parse(fs.readFileSync(labelsFile, 'utf-8')) as Labels, candidate, `${labeller} labeller of ${name}`);
            else report.waiting.push(path.join(dir, 'prompt.md'));
        }
        if (!labels.first || !labels.second) continue;

        const agreed = agree(candidate, labels.first, labels.second);
        report.closeCalls.push(...agreed.closeCalls.map(c => `${name}: ${c}`));
        if (agreed.disagreements.length > 0) {
            report.disagreements.push(...agreed.disagreements.map(d => `${name}: ${d}, left unlabelled`));
            continue;
        }
        if (agreed.expect.length === 0) {
            report.rejected.push(`${name}: no label both labellers agree on`);
            continue;
        }
        writeCase(options.fieldDir, field, candidate, caseText(options.workDir, id, source), agreed);
        fs.writeFileSync(expectationsFile, JSON.stringify(field, null, 2) + '\n');
        report.written.push(caseFile);
    }
    return report;
}

function caseText(workDir: string, id: string, source: FieldSource): string {
    return fs.readFileSync(path.join(workDir, 'first', id, path.basename(source.file)), 'utf-8');
}

// The texts of every evidence case, so a candidate repeating one is rejected before anyone labels it
function evidenceTexts(dirs: string[]): ReturnType<typeof repeatedEvidence> {
    const repeated = repeatedEvidence();
    for (const dir of dirs) {
        const set = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf-8')) as GroundTruthSet;
        for (const c of set.cases) repeated(c.languageId, `${path.basename(dir)}/${c.file}`, fs.readFileSync(path.join(dir, c.file), 'utf-8'), undefined);
    }
    return repeated;
}

async function prepare(options: LabelFieldOptions, source: FieldSource, caseFile: string, id: string, candidateFile: string, repeated: ReturnType<typeof repeatedEvidence>): Promise<string | undefined> {
    const raw = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/`;
    const languageId = source.languageId ?? LANGUAGE.find(([pattern]) => pattern.test(source.file))?.[1];
    if (!languageId) return 'no language for this file, give its languageId';
    const text = await options.fetchText(raw + source.file.split('/').map(encodeURIComponent).join('/'));
    if (text === undefined) return 'file not found at the commit';
    if (Buffer.byteLength(text) > MAX_BYTES) return `larger than ${MAX_BYTES} bytes`;
    let licence: string | undefined;
    for (const name of LICENCE_FILES) {
        licence = await options.fetchText(raw + name);
        if (licence !== undefined) break;
    }
    if (licence === undefined) return 'no licence file at the commit';
    const permissive = PERMISSIVE.find(([pattern]) => pattern.test(licence));
    if (!permissive) return 'licence is not a permissive one';
    const licenceName = permissive[1];
    const kept = path.join(options.fieldDir, caseFile.split('/')[0], 'LICENSE');
    if (fs.existsSync(kept) && fs.readFileSync(kept, 'utf-8') !== licence) return `licence differs from the one kept in ${path.relative(options.fieldDir, kept)}`;
    const earlier = repeated(languageId, `candidate ${caseFile}`, text, undefined);
    if (earlier) return `same text as ${earlier}`;

    const matches = ruleMatches(text, await analyse({ languageId, text }));
    const candidate: Candidate = { source, languageId, caseFile, licence, licenceName, lineCount: text.split('\n').length, matches };
    const prompt = labellerPrompt(candidate, text);
    for (const labeller of LABELLERS) {
        const dir = path.join(options.workDir, labeller, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, path.basename(source.file)), text);
        fs.writeFileSync(path.join(dir, 'prompt.md'), prompt);
    }
    fs.mkdirSync(path.dirname(candidateFile), { recursive: true });
    fs.writeFileSync(candidateFile, JSON.stringify(candidate, null, 2) + '\n');
    return undefined;
}

/** The prompt both labellers get: the file and the Check's matches, nothing of any other labeller. */
export function labellerPrompt(candidate: Candidate, text: string): string {
    const { source, languageId, matches } = candidate;
    const lines = text.split('\n');
    const width = String(lines.length).length;
    const criteria = [...new Set(matches.flatMap(m => m.criteria))].sort();
    return `# Label a field case for the Allyproof ground truth

You are one of two independent labellers. Judge on your own; there are no earlier labels.

File: \`${path.basename(source.file)}\` (in this directory, ${languageId}), from https://github.com/${source.repo}/blob/${source.commit}/${source.file}

The Check reported these rule matches:

${matches.length === 0 ? 'none\n' : matches.map(m => `- line ${m.line}: ${m.ruleId} (${m.criteria.join(', ')}): \`${(lines[m.line - 1] ?? '').trim().slice(0, 160)}\``).join('\n') + '\n'}
Judge the file as the source code it is, against the WCAG 2.2 A and AA success criteria, their failure techniques (F…) and the W3C ACT rules. Values that arrive at runtime (props, bindings, slots, spread attributes) are unknown: a failure that depends on them is \`unsure\`.

Give one verdict per criterion:
- every criterion of a match above${criteria.length > 0 ? ` (${criteria.join(', ')})` : ''}, required;
- any other criterion you find failing in the file, optional.

A verdict is \`fails\` with every line where the criterion fails (a match line that does not fail is left out), \`passes\` when it fails nowhere in the file, or \`unsure\` for a close call. Name the failure technique or ACT rule in the reason.

Answer with only this JSON and write it to \`labels.json\` in this directory if you can write files:

\`\`\`json
{ "criteria": [{ "criterion": "4.1.2", "verdict": "fails", "lines": [12], "reason": "button without an accessible name, F68, ACT 97a4e1" }] }
\`\`\`

The file with line numbers:

\`\`\`
${lines.map((line, i) => `${String(i + 1).padStart(width)}  ${line}`).join('\n')}
\`\`\`
`;
}

/** A labeller's answer: the JSON itself, or the JSON inside other text. */
export function parseLabels(answer: string): Labels {
    const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(answer)?.[1];
    for (const attempt of [answer, fenced, answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)]) {
        if (!attempt) continue;
        try {
            return JSON.parse(attempt) as Labels;
        } catch {
            // try the next form
        }
    }
    throw new Error(`The labeller answered no JSON: ${answer.slice(0, 200)}`);
}

function checkLabels(labels: Labels, candidate: Candidate, who: string): Labels {
    if (!Array.isArray(labels?.criteria)) throw new Error(`${who}: labels.json has no criteria list`);
    const { lineCount } = candidate;
    for (const label of labels.criteria) {
        if (!/^\d\.\d+\.\d+$/.test(label.criterion) || !['fails', 'passes', 'unsure'].includes(label.verdict)) throw new Error(`${who}: invalid label ${JSON.stringify(label)}`);
        if (label.verdict === 'fails' && (!label.lines?.length || label.lines.some(l => !Number.isInteger(l) || l < 1 || l > lineCount))) throw new Error(`${who}: ${label.criterion} fails without lines`);
    }
    const missing = [...new Set(candidate.matches.flatMap(m => m.criteria))].filter(c => !labels.criteria.some(l => l.criterion === c));
    if (missing.length > 0) throw new Error(`${who}: no verdict on ${missing.join(', ')}`);
    return labels;
}

interface Agreement {
    expect: Expectation[];
    reasons: string[];
    disagreements: string[];
    closeCalls: string[];
}

/** The labels both labellers agree on, the criteria they disagree on and the close calls. */
export function agree(candidate: Pick<Candidate, 'matches'>, first: Labels, second: Labels): Agreement {
    const result: Agreement = { expect: [], reasons: [], disagreements: [], closeCalls: [] };
    const criteria = [...new Set([...first.criteria, ...second.criteria].map(l => l.criterion))].sort(byCriterion);
    for (const criterion of criteria) {
        const a = first.criteria.find(l => l.criterion === criterion);
        const b = second.criteria.find(l => l.criterion === criterion);
        const reported = new Set(candidate.matches.filter(m => m.criteria.includes(criterion)).map(m => m.line));
        if (!a || !b) {
            result.closeCalls.push(`${criterion} judged by one labeller only (${(a ?? b)!.verdict})`);
        } else if (a.verdict === 'unsure' || b.verdict === 'unsure') {
            result.closeCalls.push(`${criterion} unsure (${a.verdict} / ${b.verdict})`);
        } else if (a.verdict !== b.verdict) {
            result.disagreements.push(`${criterion} ${a.verdict} / ${b.verdict}`);
        } else if (a.verdict === 'passes') {
            result.expect.push({ criterion, present: false });
            result.reasons.push(`${criterion} passes: ${a.reason}`);
        } else {
            const linesA = new Set(a.lines);
            const linesB = new Set(b.lines);
            const both = [...linesA].filter(l => linesB.has(l)).sort((x, y) => x - y);
            const disputed = [...new Set([...linesA, ...linesB])].filter(l => !(linesA.has(l) && linesB.has(l))).sort((x, y) => x - y);
            if (disputed.some(l => reported.has(l))) {
                result.disagreements.push(`${criterion} fails at lines ${[...linesA].join(', ')} / ${[...linesB].join(', ')}`);
                continue;
            }
            if (disputed.length > 0) result.closeCalls.push(`${criterion} at line ${disputed.join(', ')} found by one labeller only`);
            if (both.length === 0) continue;
            result.expect.push(...both.map(line => ({ criterion, line })));
            result.reasons.push(`${criterion} fails at line ${both.join(', ')}: ${a.reason}`);
        }
    }
    return result;
}

function writeCase(fieldDir: string, field: GroundTruthSet, candidate: Candidate, text: string, agreed: Agreement): void {
    const { source, caseFile, languageId, licence, licenceName, matches } = candidate;
    const target = path.join(fieldDir, caseFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    const projectDir = caseFile.split('/')[0];
    const kept = path.join(fieldDir, projectDir, 'LICENSE');
    if (!fs.existsSync(kept)) fs.writeFileSync(kept, licence);
    const reported = matches.length === 0 ? 'no match' : matches.map(m => `line ${m.line} ${m.ruleId}`).join(', ');
    const closeCalls = agreed.closeCalls.length > 0 ? ` Close calls left unlabelled: ${agreed.closeCalls.join('; ')}.` : '';
    const testCase: GroundTruthCase = {
        file: caseFile,
        languageId,
        note: `https://github.com/${source.repo}/blob/${source.commit}/${source.file} (licence in ${projectDir}/LICENSE, ${licenceName}). The Check reported ${reported}. Labels agreed by two independent labellers: ${agreed.reasons.join('; ')}.${closeCalls}`,
        expect: agreed.expect
    };
    field.cases.push(testCase);
}

function byCriterion(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

function argValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
    const sourcesFile = process.argv[2];
    if (!sourcesFile || sourcesFile.startsWith('--')) {
        console.error('Usage: npm run label:field -- <sources.json> [--labeller "<command>"] [--work <dir>]');
        process.exit(1);
    }
    const command = argValue('--labeller');
    const report = await labelField({
        sources: JSON.parse(fs.readFileSync(sourcesFile, 'utf-8')) as FieldSource[],
        fieldDir: path.join(__dirname, 'field'),
        workDir: path.resolve(argValue('--work') ?? path.join(__dirname, '..', '..', 'out', 'field-labelling')),
        evidenceDirs: ['act', 'field', 'injection'].map(set => path.join(__dirname, set)),
        fetchText: async url => {
            const response = await fetch(url);
            if (response.status === 404) return undefined;
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            return response.text();
        },
        labeller: command ? (dir, prompt) => execSync(command, { cwd: dir, input: prompt, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }) : undefined
    });
    const section = (title: string, items: string[]) => { if (items.length > 0) console.log(`\n${title}:\n  ${items.join('\n  ')}`); };
    section('Written to the field set', report.written);
    section('Disagreements, left unlabelled', report.disagreements);
    section('Close calls, left unlabelled', report.closeCalls);
    section('Rejected', report.rejected);
    section('From a project the injection set already uses (prefer another project)', report.inInjection);
    section('Waiting for labels (run each labeller on its own prompt, then run this command again)', report.waiting);
    if (report.written.length > 0) console.log('\nRun npm run test:gate -- --update and commit the field set with the changed baselines.');
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}
