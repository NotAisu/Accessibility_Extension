import * as vscode from 'vscode';
import { addSkill, DEFAULT_SKILL_TARGET, type ExistingSkill, SKILL_TARGETS, type SkillFiles, type SkillTarget, versionedSkill } from './skill-files';

const SHIPPED_SKILL = ['skills', 'allyproof', 'SKILL.md'];
const AGENTS: Record<SkillTarget, string> = {
    '.github/skills': 'GitHub Copilot, including Copilot code review',
    '.claude/skills': 'Claude Code',
    '.agents/skills': 'Other agents, such as Cursor and Codex'
};

/** The command "Add Skill to Repository": writes the Skill, carrying the extension's version, to the chosen skills folders. */
export async function addSkillToRepository(context: vscode.ExtensionContext): Promise<void> {
    const folder = await workspaceFolder();
    if (!folder) return;
    const picks = await vscode.window.showQuickPick(SKILL_TARGETS.map(target => ({ label: target, description: AGENTS[target], picked: target === DEFAULT_SKILL_TARGET, target })), {
        canPickMany: true,
        title: 'Add the Allyproof Skill to the repository',
        placeHolder: 'Skills folders to write the Skill to'
    });
    if (!picks?.length) return;

    const version = String((context.extension.packageJSON as { version: unknown }).version);
    const shipped = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, ...SHIPPED_SKILL)));
    const uri = (path: string) => vscode.Uri.joinPath(folder.uri, ...path.split('/'));
    const files: SkillFiles = {
        read: async path => {
            try {
                return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri(path)));
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined;
                throw error;
            }
        },
        write: async (path, text) => {
            await vscode.workspace.fs.createDirectory(uri(path.slice(0, path.lastIndexOf('/'))));
            await vscode.workspace.fs.writeFile(uri(path), new TextEncoder().encode(text));
        }
    };
    const added = await addSkill(picks.map(pick => pick.target), versionedSkill(shipped, version), files, existing => confirmReplace(existing, version));
    if (!added) return;

    const parts = [
        added.written.length > 0 && `Added the Allyproof Skill ${version} to ${added.written.join(', ')}. Commit it so Copilot code review and other agents review pull requests for accessibility.`,
        added.unchanged.length > 0 && `${added.unchanged.join(', ')} already holds this Skill.`,
        added.kept.length > 0 && `Kept ${added.kept.join(', ')}.`
    ].filter(part => typeof part === 'string');
    const opened = added.written[0] ?? added.unchanged[0] ?? added.kept[0];
    if (await vscode.window.showInformationMessage(parts.join(' '), 'Open Skill') === 'Open Skill' && opened) {
        await vscode.window.showTextDocument(uri(opened));
    }
}

async function workspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        void vscode.window.showWarningMessage('Open the folder of your repository to add the Allyproof Skill to it.');
        return undefined;
    }
    if (folders.length === 1) return folders[0];
    return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Repository to add the Allyproof Skill to' });
}

async function confirmReplace(existing: ExistingSkill[], version: string): Promise<boolean | undefined> {
    const answer = await vscode.window.showWarningMessage(
        existing.length === 1 ? 'A Skill file with other content already exists. Replace it?' : `${existing.length} Skill files with other content already exist. Replace them?`,
        {
            modal: true,
            detail: [
                ...existing.map(({ path, version: current }) => `${path}: ${current === undefined ? 'no version' : `Skill ${current}`}`),
                `Replacing writes Skill ${version} and discards any edits in these files. Keep Existing writes only the missing files.`
            ].join('\n')
        },
        'Replace',
        'Keep Existing'
    );
    return answer === undefined ? undefined : answer === 'Replace';
}
