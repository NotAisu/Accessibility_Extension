import * as vscode from 'vscode';
import { CHECK_SOURCE, CheckDiagnostics, codeOf } from './check-diagnostics';
import { checkLanguageId, type AnalysisDocument, type RuleSetting } from './core/analysis';
import { ignoreLine, type IgnoreLine } from './core/ignore';
import type { IgnoreFindingArgument } from './learn-hover';

/** Lightbulb actions on a Check Finding: ignore it with an inline comment where one is valid, or turn its rule off in settings. */
export class IgnoreActions implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

    constructor(private readonly check: CheckDiagnostics) {}

    async provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> {
        const actions = await Promise.all(context.diagnostics.filter(diagnostic => diagnostic.source === CHECK_SOURCE).map(async diagnostic => {
            const ruleId = String(codeOf(diagnostic));
            const line = await ignoreLineFor(this.check, document, ruleId, document.offsetAt(diagnostic.range.start));

            const disable = new vscode.CodeAction(`Disable rule ${ruleId}`, vscode.CodeActionKind.QuickFix);
            disable.diagnostics = [diagnostic];
            disable.command = { title: disable.title, command: 'allyproof.disableRule', arguments: [ruleId] };
            if (!line) return [disable];

            const ignore = new vscode.CodeAction(`Ignore this Finding (${ruleId})`, vscode.CodeActionKind.QuickFix);
            ignore.diagnostics = [diagnostic];
            ignore.edit = new vscode.WorkspaceEdit();
            ignore.edit.insert(document.uri, document.positionAt(line.offset), line.text);
            return [ignore, disable];
        }));
        return actions.flat();
    }
}

/**
 * Ignores the Finding of `ruleId` at `offset` of the document's `version` with a comment, as the lightbulb does; for the
 * hover. A document edited since then is left alone, since the offset may no longer be the Finding's.
 */
export async function ignoreFinding(check: CheckDiagnostics, { uri, ruleId, offset, version }: IgnoreFindingArgument): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    if (document.version !== version) {
        void vscode.window.showInformationMessage('The file changed since the hover was shown; hover the Finding again to ignore it.');
        return;
    }
    const line = await ignoreLineFor(check, document, ruleId, offset);
    if (!line) {
        void vscode.window.showInformationMessage(`An ignore comment cannot go above this Finding (${ruleId}); disable the rule instead.`);
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, document.positionAt(line.offset), line.text);
    await vscode.workspace.applyEdit(edit);
}

// The edited document is checked again, so a comment that breaks the code is never offered
async function ignoreLineFor(check: CheckDiagnostics, document: vscode.TextDocument, ruleId: string, offset: number): Promise<IgnoreLine | undefined> {
    const checked = { languageId: checkLanguageId(document.languageId, document.fileName), text: document.getText() };
    const findingsOf = async (edited: AnalysisDocument) => {
        const outcome = await check.checkFor(edited);
        return outcome.status === 'done' ? outcome.result.findings : undefined;
    };
    return ignoreLine(checked, { ruleId, range: { start: offset, end: offset } }, findingsOf);
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
