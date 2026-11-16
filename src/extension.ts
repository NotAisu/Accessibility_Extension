import * as vscode from 'vscode';
import { isChecked } from './core/analysis';
import { CheckDiagnostics } from './check-diagnostics';
import { AIReview } from './ai-review-ui';
import { FindingsTree } from './findings-tree';
import { A11yCheckTool } from './a11y-check-tool';
import { disableRule, IgnoreActions } from './ignore-actions';
import { CheckFixes } from './check-fixes';

// VS Code language ids; TypeScript files hold inline Angular templates
const SUPPORTED_LANGUAGES = ['html', 'vue', 'svelte', 'javascriptreact', 'typescriptreact', 'astro', 'typescript'];
// What a11y_check accepts for proposed code: the Check's own ids, `angular` for an Angular component template
const CHECK_LANGUAGES = [...SUPPORTED_LANGUAGES, 'angular'];

/** What the extension-host smoke tests observe; only returned when VS Code runs extension tests. */
export interface TestingApi {
    findings: Pick<FindingsTree, 'getChildren' | 'getTreeItem'>;
    findingsStatus: vscode.StatusBarItem;
    aiReviewStatus: vscode.StatusBarItem;
}

export function activate(context: vscode.ExtensionContext): TestingApi | undefined {
    // Editors without the language model API (some VS Code forks) hide the Skill and a11y_check, and the AI Review
    // unless it uses a local model
    const lmAvailable = typeof vscode.lm?.registerTool === 'function';
    const aiAvailable = () => lmAvailable || vscode.workspace.getConfiguration('allyproof').get<string>('aiReview.provider') === 'local';
    const tree = new FindingsTree(aiAvailable());
    const check = new CheckDiagnostics(tree);
    const fixes = new CheckFixes(check);
    const aiReview = new AIReview(context, checked, (document, scope) => check.findingsOf(document, scope), tree);
    const runDiagnostics = (document: vscode.TextDocument) => checkDocument(check, document);

    context.subscriptions.push(
        tree,
        check,
        aiReview,
        vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, check),
        vscode.languages.registerCodeActionsProvider(SUPPORTED_LANGUAGES, new IgnoreActions(check), IgnoreActions.metadata),
        vscode.languages.registerCodeActionsProvider(SUPPORTED_LANGUAGES, fixes, CheckFixes.metadata),
        vscode.workspace.onWillSaveTextDocument(event => fixes.fixOnSave(event)),
        vscode.commands.registerCommand('allyproof.startAIReview', () => aiReview.start()),
        vscode.commands.registerCommand('allyproof.cancelAIReview', () => aiReview.cancel()),
        vscode.commands.registerCommand('allyproof.clearAIReviewCache', () => aiReview.clearCache()),
        vscode.commands.registerCommand('allyproof.filterFindings', () => tree.filter()),
        vscode.commands.registerCommand('allyproof.disableRule', disableRule),
        vscode.workspace.onDidOpenTextDocument(runDiagnostics),
        vscode.workspace.onDidSaveTextDocument(async document => {
            await runDiagnostics(document);
            aiReview.reviewOnSave(document);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('allyproof.rules')) vscode.workspace.textDocuments.forEach(document => void runDiagnostics(document));
            if (event.affectsConfiguration('allyproof.aiReview')) {
                void vscode.commands.executeCommand('setContext', 'allyproof.aiAvailable', aiAvailable());
                void aiReview.showIdle();
            }
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(() => void aiReview.showIdle()),
        vscode.workspace.onDidCloseTextDocument(document => {
            check.delete(document.uri);
            aiReview.delete(document.uri);
        })
    );
    void vscode.commands.executeCommand('setContext', 'allyproof.aiAvailable', aiAvailable());
    if (lmAvailable) {
        context.subscriptions.push(
            vscode.lm.onDidChangeChatModels(() => void aiReview.showIdle()),
            vscode.lm.registerTool('a11y_check', new A11yCheckTool(CHECK_LANGUAGES, document => check.checkFor(document)))
        );
    }

    check.start(context.asAbsolutePath('dist/worker.mjs'));
    vscode.window.visibleTextEditors.forEach(editor => void runDiagnostics(editor.document));
    if (context.extensionMode === vscode.ExtensionMode.Test) {
        return { findings: tree, findingsStatus: tree.status, aiReviewStatus: aiReview.status };
    }
}

// TypeScript files only while they hold an Angular component, as the Check's own gate decides
function checked(document: vscode.TextDocument): boolean {
    return SUPPORTED_LANGUAGES.includes(document.languageId) && isChecked({ languageId: document.languageId, text: document.getText() });
}

async function checkDocument(check: CheckDiagnostics, document: vscode.TextDocument): Promise<void> {
    if (!SUPPORTED_LANGUAGES.includes(document.languageId)) return;
    // A file that no longer holds a component keeps no Findings
    if (!checked(document)) return check.delete(document.uri);
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
