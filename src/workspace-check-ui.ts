import * as vscode from 'vscode';
import type { CheckDiagnostics } from './check-diagnostics';
import type { FindingsTree } from './findings-tree';
import { Gitignore, ignoredFiles, positionsOf, WORKSPACE_GLOB, WorkspaceCheck, WorkspaceFile, WorkspaceCheckSummary } from './workspace-check';

/**
 * The "Check Workspace" command (#34): checks every supported file that `files.exclude` and `.gitignore` leave, in
 * the analysis worker, with cancellable progress. Its Findings fill the Findings tree only; diagnostics stay with
 * the open files, so the Problems panel never fills with files nobody opened.
 */
export class WorkspaceCheckCommand {
    private readonly workspace: WorkspaceCheck;
    private running: Promise<void> | undefined;

    constructor(check: CheckDiagnostics, private readonly tree: FindingsTree, private readonly log: vscode.LogOutputChannel) {
        this.workspace = new WorkspaceCheck({
            read: async file => new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(file.uri))),
            options: file => check.optionsFor(vscode.Uri.parse(file.uri)),
            check: (file, document) => check.checkFile(vscode.Uri.parse(file.uri), document),
            report: (file, text, outcome) => {
                const uri = vscode.Uri.parse(file.uri);
                if (outcome.status === 'paused') return this.tree.setPaused(uri, outcome.reason);
                const position = positionsOf(text);
                this.tree.setCheck({ uri, positionAt: offset => {
                    const { line, character } = position(offset);
                    return new vscode.Position(line, character);
                } }, outcome.result);
            },
            remove: uri => this.tree.deleteCheck(vscode.Uri.parse(uri))
        });
    }

    /** Runs the workspace Check; while one runs, invoking it again only shows its progress. */
    run(): Promise<void> {
        this.running ??= this.checkWorkspace().finally(() => this.running = undefined);
        return this.running;
    }

    /** Whether the workspace Check shows results for the file, which then stay in the tree once its editor closes. */
    covers(uri: vscode.Uri): boolean {
        return this.workspace.covers(uri.toString());
    }

    /** A file whose editor closed shows its text on disk again, which may differ from the unsaved text last checked. */
    async closed(uri: vscode.Uri): Promise<void> {
        if (!this.covers(uri)) return;
        await this.workspace.recheck({ uri: uri.toString(), path: uri.path });
    }

    private async checkWorkspace(): Promise<void> {
        if (!vscode.workspace.workspaceFolders?.length) {
            void vscode.window.showInformationMessage('Open a folder to check its files.');
            return;
        }
        void vscode.commands.executeCommand('allyproof.findings.focus');
        const summary = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Allyproof: Checking workspace',
            cancellable: true
        }, async (progress, token) => {
            progress.report({ message: 'Finding files…' });
            const files = await workspaceFiles(token);
            let reported = 0;
            return this.workspace.run(files, {
                isOpen: uri => vscode.workspace.textDocuments.some(document => document.uri.toString() === uri),
                progress: (done, total) => {
                    const percent = total === 0 ? 100 : Math.floor(done / total * 100);
                    progress.report({ message: `${done} of ${total} files`, increment: percent - reported });
                    reported = percent;
                },
                cancelled: () => token.isCancellationRequested
            });
        });
        this.log.info(summaryLine(summary));
    }
}

// Every supported file of the workspace that `files.exclude` (findFiles's default exclude) and `.gitignore` leave
async function workspaceFiles(token: vscode.CancellationToken): Promise<WorkspaceFile[]> {
    const [candidates, gitignoreUris] = await Promise.all([
        vscode.workspace.findFiles(WORKSPACE_GLOB, undefined, undefined, token),
        vscode.workspace.findFiles('**/.gitignore', undefined, undefined, token)
    ]);
    const gitignores = await Promise.all(gitignoreUris.map(async (uri): Promise<Gitignore> => ({
        dir: uri.path.slice(0, -'/.gitignore'.length),
        content: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
    })));
    const ignored = ignoredFiles(gitignores);
    return candidates
        .filter(uri => !ignored(uri.path))
        .map(uri => ({ uri: uri.toString(), path: uri.path }))
        .sort((a, b) => a.path.localeCompare(b.path));
}

function summaryLine({ files, checked, unchanged, paused, cancelled }: WorkspaceCheckSummary): string {
    return `Workspace Check ${cancelled ? 'cancelled' : 'done'}: ${files} files, ${checked} checked, ${unchanged} unchanged, ${paused} paused`;
}
