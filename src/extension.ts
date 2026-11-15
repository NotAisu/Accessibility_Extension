import * as vscode from 'vscode';
import { CheckDiagnostics } from './check-diagnostics';
import { AIReview } from './ai-review-ui';
import { FindingsTree } from './findings-tree';
import { A11yCheckTool } from './a11y-check-tool';
import { disableRule, IgnoreActions } from './ignore-actions';
import { CheckFixes } from './check-fixes';

const SUPPORTED_LANGUAGES = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact', 'astro'];

export function activate(context: vscode.ExtensionContext): void {
    // Editors without the language model API (some VS Code forks) hide the AI Review, the Skill and a11y_check
    const aiAvailable = typeof vscode.lm?.registerTool === 'function';
    const tree = new FindingsTree(aiAvailable);
    const check = new CheckDiagnostics(tree);
    const fixes = new CheckFixes(check);
    const aiReview = new AIReview(context, SUPPORTED_LANGUAGES, document => check.findingsOf(document), tree);
    const runDiagnostics = (document: vscode.TextDocument) => checkDocument(check, document);

    context.subscriptions.push(
        tree,
        check,
        aiReview,
        vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, check),
        vscode.languages.registerCodeActionsProvider(SUPPORTED_LANGUAGES, new IgnoreActions(), IgnoreActions.metadata),
        vscode.languages.registerCodeActionsProvider(SUPPORTED_LANGUAGES, fixes, CheckFixes.metadata),
        vscode.workspace.onWillSaveTextDocument(event => fixes.fixOnSave(event)),
        vscode.commands.registerCommand('allyproof.startAIReview', () => aiReview.start()),
        vscode.commands.registerCommand('allyproof.cancelAIReview', () => aiReview.cancel()),
        vscode.commands.registerCommand('allyproof.filterFindings', () => tree.filter()),
        vscode.commands.registerCommand('allyproof.disableRule', disableRule),
        vscode.workspace.onDidOpenTextDocument(runDiagnostics),
        vscode.workspace.onDidSaveTextDocument(async document => {
            await runDiagnostics(document);
            aiReview.reviewOnSave(document);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('allyproof.rules')) vscode.workspace.textDocuments.forEach(document => void runDiagnostics(document));
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            check.delete(document.uri);
            aiReview.delete(document.uri);
        })
    );
    if (aiAvailable) {
        void vscode.commands.executeCommand('setContext', 'allyproof.aiAvailable', true);
        context.subscriptions.push(
            vscode.lm.onDidChangeChatModels(() => void aiReview.showIdle()),
            vscode.workspace.onDidGrantWorkspaceTrust(() => void aiReview.showIdle()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('allyproof.aiReview')) void aiReview.showIdle();
            }),
            vscode.lm.registerTool('a11y_check', new A11yCheckTool(SUPPORTED_LANGUAGES, document => check.checkFor(document)))
        );
    }

    check.start(context.asAbsolutePath('dist/worker.mjs'));
    vscode.window.visibleTextEditors.forEach(editor => void runDiagnostics(editor.document));
}

async function checkDocument(check: CheckDiagnostics, document: vscode.TextDocument): Promise<void> {
    if (!SUPPORTED_LANGUAGES.includes(document.languageId)) return;
    try {
        await check.update(document);
    } catch (error) {
        if (error instanceof Error && error.message === 'axe-timeout') {
            console.warn('axe-core analysis aborted after timeout');
        } else {
            console.error('Error in accessibility analysis:', error);
        }
        check.delete(document.uri);
    }
}

export function deactivate(): void {}
