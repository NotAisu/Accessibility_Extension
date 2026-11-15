import * as vscode from 'vscode';
import { CHECK_SOURCE } from './check-diagnostics';
import type { RuleSetting } from './core/analysis';
import { ignoreComment } from './core/ignore';

/** Lightbulb actions on a Check Finding: ignore it with an inline comment, or turn its rule off in settings. */
export class IgnoreActions implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        return context.diagnostics.filter(diagnostic => diagnostic.source === CHECK_SOURCE).flatMap(diagnostic => {
            const ruleId = String(typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code);
            const line = document.lineAt(diagnostic.range.start.line);
            const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
            const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

            const ignore = new vscode.CodeAction(`Ignore this finding (${ruleId})`, vscode.CodeActionKind.QuickFix);
            ignore.diagnostics = [diagnostic];
            ignore.edit = new vscode.WorkspaceEdit();
            ignore.edit.insert(document.uri, line.range.start, `${indent}${ignoreComment(document.languageId, ruleId)}${eol}`);

            const disable = new vscode.CodeAction(`Disable rule ${ruleId}`, vscode.CodeActionKind.QuickFix);
            disable.diagnostics = [diagnostic];
            disable.command = { title: disable.title, command: 'allyproof.disableRule', arguments: [ruleId] };
            return [ignore, disable];
        });
    }
}

/** Turns the rule off in the workspace settings, or the user settings without a workspace. */
export async function disableRule(ruleId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('allyproof');
    const inWorkspace = vscode.workspace.workspaceFolders !== undefined;
    const rules = config.inspect<Record<string, RuleSetting>>('rules');
    const current = (inWorkspace ? rules?.workspaceValue : rules?.globalValue) ?? {};
    await config.update(
        'rules',
        { ...current, [ruleId]: 'off' },
        inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );
}
