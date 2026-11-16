import { createHash } from 'crypto';
import ignore, { Ignore } from 'ignore';
import type { CheckOutcome } from './analysis-worker';
import { AnalysisDocument, AnalysisOptions, checkLanguageId, isChecked } from './core/analysis';

// The project-wide Check (#34) as plain logic; workspace-check-ui.ts finds the files and shows the results in VS Code

// The VS Code language id of a file the Check analyses, by its extension, since files that are not open have none
const LANGUAGE_OF_EXTENSION: Record<string, string> = {
    html: 'html',
    htm: 'html',
    vue: 'vue',
    svelte: 'svelte',
    jsx: 'javascriptreact',
    tsx: 'typescriptreact',
    astro: 'astro',
    ts: 'typescript'
};

/** The glob of every file the workspace Check may analyse. */
export const WORKSPACE_GLOB = `**/*.{${Object.keys(LANGUAGE_OF_EXTENSION).join(',')}}`;

/** The VS Code language id of the file at `path`, or undefined for a file the Check never analyses. */
export function workspaceLanguageId(path: string): string | undefined {
    const extension = /\.([^./]+)$/.exec(path)?.[1].toLowerCase();
    return extension === undefined ? undefined : LANGUAGE_OF_EXTENSION[extension];
}

/** A `.gitignore` file: `dir` is the absolute path of the folder it is in, without a trailing slash. */
export interface Gitignore {
    dir: string;
    content: string;
}

/**
 * Whether git ignores the file at the absolute `path`, by the `.gitignore` files of its folders: a deeper file's
 * rules override a shallower one's, and nothing inside an ignored folder can be re-included. Installed dependencies
 * are never project code, ignored or not.
 */
export function ignoredFiles(gitignores: Gitignore[]): (path: string) => boolean {
    const levels: { dir: string; rules: Ignore }[] = [...gitignores]
        .sort((a, b) => a.dir.length - b.dir.length)
        .map(({ dir, content }) => ({ dir, rules: ignore().add(content) }));
    // Last match wins over all levels above the path; `path` is a folder when it ends in a slash
    const matched = (path: string): boolean => {
        let ignored = false;
        for (const { dir, rules } of levels) {
            // A folder's own .gitignore says nothing about the folder
            if (!path.startsWith(`${dir}/`) || path.length === dir.length + 1) continue;
            const result = rules.test(path.slice(dir.length + 1));
            if (result.ignored) ignored = true;
            else if (result.unignored) ignored = false;
        }
        return ignored;
    };
    return path => {
        if (path.split('/').includes('node_modules')) return true;
        const folders = path.split('/').slice(0, -1);
        for (let depth = 2; depth <= folders.length; depth++) {
            if (matched(`${folders.slice(0, depth).join('/')}/`)) return true;
        }
        return matched(path);
    };
}

/** A file to check; `uri` is its key, `path` its absolute path, which says its language. */
export interface WorkspaceFile {
    uri: string;
    path: string;
}

export interface WorkspaceCheckHost {
    read(file: WorkspaceFile): Promise<string>;
    options(file: WorkspaceFile): AnalysisOptions;
    check(file: WorkspaceFile, document: AnalysisDocument): Promise<CheckOutcome>;
    /** Shows the outcome of the file's Check, of exactly `text`. */
    report(file: WorkspaceFile, text: string, outcome: CheckOutcome & { status: 'done' | 'paused' }): void;
    /** Removes the results of a file that is no longer part of the workspace Check. */
    remove(uri: string): void;
}

export interface WorkspaceCheckRun {
    /** Files checked live in an editor, skipped since their Findings are already current. */
    isOpen(uri: string): boolean;
    progress(done: number, total: number): void;
    cancelled(): boolean;
}

export interface WorkspaceCheckSummary {
    files: number;
    checked: number;
    unchanged: number;
    paused: number;
    cancelled: boolean;
}

/**
 * Checks every given file one at a time in the analysis worker, so the editor's own Checks never wait for more than
 * one file. Re-running only re-checks files whose text or rule settings changed since their last Check.
 */
export class WorkspaceCheck {
    // The fingerprint of what each file's shown results were checked from
    private readonly checked = new Map<string, string>();

    constructor(private readonly host: WorkspaceCheckHost) {}

    /** Whether the workspace Check shows results for the file. */
    covers(uri: string): boolean {
        return this.checked.has(uri);
    }

    private invalidate(uri: string): void {
        if (this.checked.has(uri)) this.checked.set(uri, '');
    }

    /** Checks the one file again now, keeping the results of every other file. */
    async recheck(file: WorkspaceFile): Promise<void> {
        this.invalidate(file.uri);
        await this.checkFile(file);
    }

    async run(files: WorkspaceFile[], run: WorkspaceCheckRun): Promise<WorkspaceCheckSummary> {
        const summary: WorkspaceCheckSummary = { files: files.length, checked: 0, unchanged: 0, paused: 0, cancelled: false };
        const listed = new Set(files.map(file => file.uri));
        for (const uri of [...this.checked.keys()].filter(uri => !listed.has(uri))) {
            this.checked.delete(uri);
            if (!run.isOpen(uri)) this.host.remove(uri);
        }
        for (const [done, file] of files.entries()) {
            if (run.cancelled()) {
                summary.cancelled = true;
                break;
            }
            run.progress(done, files.length);
            if (run.isOpen(file.uri)) continue;
            const outcome = await this.checkFile(file);
            if (outcome === 'unchanged') summary.unchanged++;
            else if (outcome === 'checked') summary.checked++;
            else if (outcome === 'paused') summary.paused++;
        }
        if (!summary.cancelled) run.progress(files.length, files.length);
        return summary;
    }

    private async checkFile(file: WorkspaceFile): Promise<'checked' | 'unchanged' | 'paused' | 'skipped'> {
        let text: string;
        try {
            text = await this.host.read(file);
        } catch {
            // Deleted or unreadable since it was listed
            return this.forget(file.uri);
        }
        const languageId = workspaceLanguageId(file.path);
        const document = languageId === undefined ? undefined : { languageId: checkLanguageId(languageId, file.path), text };
        // A TypeScript file without an Angular component holds nothing the Check analyses
        if (!document || !isChecked({ languageId: languageId!, text })) return this.forget(file.uri);
        const options = this.host.options(file);
        const fingerprint = createHash('sha256').update(JSON.stringify([document.languageId, options])).update(text).digest('hex');
        if (this.checked.get(file.uri) === fingerprint) return 'unchanged';
        const outcome = await this.host.check(file, document);
        if (outcome.status === 'dropped') return 'skipped';
        this.host.report(file, text, outcome);
        // A paused file is checked again on the next run, unless its own size made it overrun the deadline
        this.checked.set(file.uri, outcome.status === 'done' || outcome.deadlineExceeded ? fingerprint : '');
        return outcome.status === 'done' ? 'checked' : 'paused';
    }

    private forget(uri: string): 'skipped' {
        if (this.checked.delete(uri)) this.host.remove(uri);
        return 'skipped';
    }
}

/** The 0-based line and character of each offset into `text`, as VS Code counts lines of a file that is not open. */
export function positionsOf(text: string): (offset: number) => { line: number; character: number } {
    const starts = [0, ...[...text.matchAll(/\r\n|\r|\n/g)].map(m => m.index + m[0].length)];
    return offset => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        return { line: low, character: offset - starts[low] };
    };
}
