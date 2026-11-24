import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AnalysisWorker } from '../analysis-worker';
import { checkLanguageId, isChecked, type AnalysisOptions, type Severity } from '../core/analysis';
import { workspaceLanguageId } from '../workspace-check';
import { elementOf, matchBaseline, type Baseline } from './baseline';
import { fileOutput, SCHEMA_VERSION, type CheckOutput, type FileOutput } from './output';
import { optionsFromSettings } from './settings';

// The Check of the command line's front ends (`check` and `mcp`): the same sources, settings and JSON result

/** The language ids the Check analyses. */
export const LANGUAGES = ['html', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'angular', 'typescript'] as const;

export const SEVERITY_RANK: Record<Severity, number> = { information: 1, warning: 2, error: 3 };

export interface Source {
    /** Repository-relative path with forward slashes. */
    file: string;
    read(): string;
    /** The language of text without a file name of its own; otherwise it comes from `file`. */
    languageId?: string;
}

export const posix = (file: string) => file.split(path.sep).join('/');

/** The Check's options from the project's `.vscode/settings.json`, read as data. */
export function settingsOf(root: string): AnalysisOptions {
    const file = path.join(root, '.vscode', 'settings.json');
    return fs.existsSync(file) ? optionsFromSettings(fs.readFileSync(file, 'utf-8'), posix(path.relative(process.cwd(), file)) || file) : {};
}

export function git(root: string, args: string[]): string {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export const isRepository = (root: string) => fs.existsSync(path.join(root, '.git'));

/**
 * The files the Check analyses under the root-relative `prefixes` ('' is the whole root), sorted: the files Git does
 * not ignore, or every file outside node_modules and dot folders in a folder that is not a repository.
 */
export function treeFiles(root: string, prefixes: string[]): string[] {
    const inside = (file: string) => prefixes.some(prefix => prefix === '' || file === prefix || file.startsWith(`${prefix}/`));
    const files = isRepository(root)
        ? git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
        : walk(root, '');
    return files.filter(file => inside(file) && workspaceLanguageId(file) && fs.existsSync(path.join(root, file))).sort();
}

function walk(root: string, dir: string): string[] {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const file = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
        return entry.isDirectory() ? walk(root, file) : [file];
    });
}

// Read lazily and once: a file is read when it is checked
export function diskSource(root: string, file: string): Source {
    let content: string | undefined;
    return { file, read: () => content ??= fs.readFileSync(path.join(root, file), 'utf-8') };
}

export async function checkAll(sources: Source[], options: AnalysisOptions, baseline: Baseline | undefined, failOn: number): Promise<CheckOutput> {
    // The worker next to this script; it holds the engines, so a crash or a runaway engine never takes the run with it
    const worker = new AnalysisWorker(path.join(path.dirname(fs.realpathSync(process.argv[1])), 'worker.mjs'));
    const files: FileOutput[] = [];
    try {
        for (const source of sources) {
            const languageId = checkLanguageId(source.languageId ?? workspaceLanguageId(source.file) ?? '', source.file);
            const content = source.read();
            const document = { languageId, text: content };
            if (!isChecked(document)) continue;
            const outcome = await worker.check(source.file, document, options, { background: true });
            if (outcome.status !== 'done') {
                files.push({ file: source.file, languageId, status: 'failed', error: outcome.status === 'paused' ? outcome.reason : 'dropped', findings: [], needsReview: [] });
                continue;
            }
            const elements = outcome.result.findings.map(f => ({ ruleId: f.ruleId, file: source.file, element: elementOf(content, f) }));
            const baselined = baseline ? matchBaseline(baseline, elements, new Set()).baselined : elements.map(() => false);
            files.push(fileOutput(source.file, languageId, content, outcome.result, baselined));
        }
    } finally {
        worker.dispose();
    }
    const findings = files.flatMap(file => file.findings);
    const elements = files.flatMap(file => file.findings.map(f => ({ ruleId: f.ruleId, file: file.file, element: elementAt(sources, file.file, f.range.start.offset) })));
    return {
        schemaVersion: SCHEMA_VERSION,
        files,
        summary: {
            files: files.length,
            failedFiles: files.filter(file => file.status === 'failed').length,
            findings: findings.length,
            blocking: findings.filter(f => !f.baselined && SEVERITY_RANK[f.severity] >= failOn).length,
            baselined: findings.filter(f => f.baselined).length,
            fixedSinceBaseline: baseline ? matchBaseline(baseline, elements, new Set(files.map(file => file.file))).fixed : 0,
            needsReview: files.reduce((sum, file) => sum + file.needsReview.length, 0)
        }
    };
}

export function elementAt(sources: Source[], file: string, offset: number): string {
    const content = sources.find(source => source.file === file)!.read();
    return elementOf(content, { range: { start: offset, end: offset } });
}
