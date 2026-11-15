import * as vscode from 'vscode';
import { analyse } from './core/analysis';
import { CheckDiagnostics } from './check-diagnostics';
import { AIReview } from './ai-review-ui';

const SUPPORTED_LANGUAGES = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact'];

const check = new CheckDiagnostics();

export function activate(context: vscode.ExtensionContext): void {
    const aiReview = new AIReview(context, SUPPORTED_LANGUAGES, async document => (await analyse(document)).findings);

    context.subscriptions.push(
        check,
        aiReview,
        vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, check),
        vscode.commands.registerCommand('allyproof.startAIReview', () => aiReview.start()),
        vscode.commands.registerCommand('allyproof.cancelAIReview', () => aiReview.cancel()),
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

    vscode.window.visibleTextEditors.forEach(editor => void runDiagnostics(editor.document));
}

async function runDiagnostics(document: vscode.TextDocument): Promise<void> {
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
