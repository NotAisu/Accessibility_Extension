import { chmod } from 'fs/promises';
import * as vscode from 'vscode';
import { planCommitCheck } from './commit-check';

/** The command "Set Up Commit Check": blocks commits that add Findings, in the project's own hook manager (#79). */
export async function setUpCommitCheck(context: vscode.ExtensionContext): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder = folders.length > 1
        ? await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Repository to set up the commit check in' })
        : folders[0];
    if (!folder) {
        if (folders.length === 0) void vscode.window.showWarningMessage('Open the folder of your repository to set up the commit check.');
        return;
    }
    const choice = await vscode.window.showQuickPick([
        { label: 'Commit hook', description: 'Blocks a commit that adds Findings', workflow: false },
        { label: 'Commit hook and GitHub Actions workflow', description: 'Also fails a pull request that adds Findings', workflow: true }
    ], { title: 'Set Up Commit Check' });
    if (!choice) return;

    const uri = (path: string) => vscode.Uri.joinPath(folder.uri, ...path.split('/'));
    const read = async (path: string) => {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri(path)));
        } catch (error) {
            if (error instanceof vscode.FileSystemError) return undefined;
            throw error;
        }
    };
    const version = String((context.extension.packageJSON as { version: unknown }).version);
    const plan = await planCommitCheck(read, { workflow: choice.workflow, actionRef: `NotAisu/Accessibility_Extension@v${version}` });
    if (plan.files.length === 0) {
        void vscode.window.showInformationMessage('This repository already runs the Allyproof commit check.');
        return;
    }
    const answer = await vscode.window.showInformationMessage(`Set up the commit check with ${plan.manager}?`, {
        modal: true,
        detail: [
            ...plan.files.map(file => `${file.before === undefined ? 'Create' : 'Change'} ${file.path}`),
            'Existing entries are kept. Git\'s own --no-verify still skips the hook.'
        ].join('\n')
    }, 'Write');
    if (answer !== 'Write') return;

    for (const file of plan.files) {
        await vscode.workspace.fs.createDirectory(uri(file.path.slice(0, file.path.lastIndexOf('/')) || '.'));
        await vscode.workspace.fs.writeFile(uri(file.path), new TextEncoder().encode(file.after));
        if (file.executable && folder.uri.scheme === 'file') await chmod(uri(file.path).fsPath, 0o755);
    }
    const written = plan.files.find(file => !file.path.startsWith('.git/')) ?? plan.files[0];
    if (await vscode.window.showInformationMessage(`Set up the commit check with ${plan.manager}.`, 'Open File') === 'Open File') {
        await vscode.window.showTextDocument(uri(written.path));
    }
}
