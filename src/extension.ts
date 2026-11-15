import * as vscode from 'vscode';
import { CheckDiagnostics } from './check-diagnostics';
import { AIReview } from './ai-review-ui';
import { FindingsTree } from './findings-tree';

const SUPPORTED_LANGUAGES = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];

export function activate(context: vscode.ExtensionContext): void {
    const tree = new FindingsTree();
    const check = new CheckDiagnostics(tree);
    const aiReview = new AIReview(context, SUPPORTED_LANGUAGES, document => check.findingsOf(document), (document, findings) => tree.setAI(document, findings));
    const runDiagnostics = (document: vscode.TextDocument) => checkDocument(check, document);

    context.subscriptions.push(
        tree,
        check,
        aiReview,
        vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, check),
        vscode.commands.registerCommand('allyproof.startAIReview', () => aiReview.start()),
        vscode.commands.registerCommand('allyproof.cancelAIReview', () => aiReview.cancel()),
        vscode.commands.registerCommand('allyproof.filterFindings', () => tree.filter()),
        vscode.workspace.onDidOpenTextDocument(runDiagnostics),
        vscode.workspace.onDidSaveTextDocument(async document => {
            await runDiagnostics(document);
            aiReview.reviewOnSave(document);
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            check.delete(document.uri);
            aiReview.delete(document.uri);
        })
    );
    // Editors without the language model API (some VS Code forks) keep the "Set up AI Review" hint
    if (typeof vscode.lm?.onDidChangeChatModels === 'function') {
        context.subscriptions.push(vscode.lm.onDidChangeChatModels(() => void aiReview.showIdle()));
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
