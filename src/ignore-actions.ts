import * as vscode from 'vscode';
import { CHECK_SOURCE, CheckDiagnostics, codeOf } from './check-diagnostics';
import { checkLanguageId, type AnalysisDocument, type RuleSetting } from './core/analysis';
import { ignoreLine } from './core/ignore';

/** Lightbulb actions on a Check Finding: ignore it with an inline comment where one is valid, or turn its rule off in settings. */
export class IgnoreActions implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

    constructor(private readonly check: CheckDiagnostics) {}

    async provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> {
        const checked = { languageId: checkLanguageId(document.languageId, document.fileName), text: document.getText() };
        // The edited document is checked again, so a comment that breaks the code is never offered
        const findingsOf = async (edited: AnalysisDocument) => {
            const outcome = await this.check.checkFor(edited);
            return outcome.status === 'done' ? outcome.result.findings : undefined;
        };
        const actions = await Promise.all(context.diagnostics.filter(diagnostic => diagnostic.source === CHECK_SOURCE).map(async diagnostic => {
            const ruleId = String(codeOf(diagnostic));
            const offset = document.offsetAt(diagnostic.range.start);
            const line = await ignoreLine(checked, { ruleId, range: { start: offset, end: offset } }, findingsOf);

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
