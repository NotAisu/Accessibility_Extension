import * as vscode from 'vscode';
import { CHECK_SOURCE, CheckDiagnostics, codeOf, Reported } from './check-diagnostics';

const FIX_ALL = vscode.CodeActionKind.SourceFixAll.append('allyproof');

/**
 * Offers the Check's deterministic fixes as preferred quick fixes, and those that guess nothing under source.fixAll
 * and, if enabled, on save.
 */
export class CheckFixes implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, FIX_ALL]
    };

    constructor(private readonly check: CheckDiagnostics) {}

    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        const fixable = this.check.fixable(document);
        if (fixable.length === 0) return [];
        if (context.only && !context.only.contains(vscode.CodeActionKind.QuickFix)) {
            const unattended = fixable.filter(({ finding }) => !finding.quickFixOnly);
            if (unattended.length === 0) return [];
            const fixAll = new vscode.CodeAction('Fix all Allyproof Findings with a deterministic fix', FIX_ALL);
            fixAll.edit = edit(document, unattended);
            return [fixAll];
        }
        return context.diagnostics.filter(diagnostic => diagnostic.source === CHECK_SOURCE).flatMap(diagnostic => {
            const reported = fixable.find(({ range, finding }) =>
                range.isEqual(diagnostic.range) && codeOf(diagnostic) === finding.ruleId);
            if (!reported) return [];
            const action = new vscode.CodeAction(`Fix this Finding (${reported.finding.ruleId})`, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = edit(document, [reported]);
            return [action];
        });
    }

    /** Applies every deterministic fix before the document is saved, when the user opted in. */
    fixOnSave(event: vscode.TextDocumentWillSaveEvent): void {
        if (!vscode.workspace.getConfiguration('allyproof', event.document).get<boolean>('check.fixOnSave', false)) return;
        const edits = textEdits(event.document, this.check.fixable(event.document).filter(({ finding }) => !finding.quickFixOnly));
        if (edits.length > 0) event.waitUntil(Promise.resolve(edits));
    }
}

function edit(document: vscode.TextDocument, fixable: Reported[]): vscode.WorkspaceEdit {
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(document.uri, textEdits(document, fixable));
    return workspaceEdit;
}

function textEdits(document: vscode.TextDocument, fixable: Reported[]): vscode.TextEdit[] {
    return fixable.flatMap(({ finding }) => (finding.fix ?? []).map(({ range, newText }) =>
        vscode.TextEdit.replace(new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)), newText)));
}
