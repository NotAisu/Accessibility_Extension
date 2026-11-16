import * as os from 'os';
import * as vscode from 'vscode';
import { isChecked } from './core/analysis';
import { logText } from './core/log-text';
import { CheckDiagnostics } from './check-diagnostics';
import { AIReview } from './ai-review-ui';
import { FindingsTree } from './findings-tree';
import { A11yCheckTool } from './a11y-check-tool';
import { disableRule, IgnoreActions, ignoreFinding } from './ignore-actions';
import { CheckFixes } from './check-fixes';
import { issueUrl } from './report-issue';
import type { IgnoreFindingArgument } from './learn-hover';

const REPOSITORY = 'https://github.com/NotAisu/Accessibility_Extension';

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
    // Failures, deadlines, respawns and AI errors; never file contents or prompts
    const log = vscode.window.createOutputChannel('Allyproof', { log: true });
    const tree = new FindingsTree(aiAvailable());
    const check = new CheckDiagnostics(tree, aiAvailable);
    const fixes = new CheckFixes(check);
    const aiReview = new AIReview(context, checked, (document, scope) => check.findingsOf(document, scope), tree, log);
    const runDiagnostics = (document: vscode.TextDocument) => checkDocument(check, document, log);
    const forget = (uri: vscode.Uri) => {
        check.delete(uri);
        aiReview.delete(uri);
    };

    context.subscriptions.push(
        log,
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
        vscode.commands.registerCommand('allyproof.ignoreFinding', (argument: IgnoreFindingArgument) => ignoreFinding(check, argument)),
        vscode.commands.registerCommand('allyproof.showLog', () => log.show()),
        vscode.commands.registerCommand('allyproof.reportIssue', () => vscode.env.openExternal(vscode.Uri.parse(issueUrl(REPOSITORY, {
            extension: String((context.extension.packageJSON as { version: unknown }).version),
            editor: `${vscode.env.appName} ${vscode.version}`,
            os: `${os.platform()} ${os.release()} (${os.arch()})`,
            remote: vscode.env.remoteName,
            engines: check.engines()
        })))),
        vscode.workspace.onDidOpenTextDocument(runDiagnostics),
        vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
            if (contentChanges.length > 0) check.changed(document, () => void runDiagnostics(document));
        }),
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
        vscode.workspace.onDidCloseTextDocument(document => forget(document.uri)),
        // VS Code closes a document some time after its last tab, so its Findings go with the tab
        vscode.window.tabGroups.onDidChangeTabs(({ closed }) => closed.forEach(tab => {
            const uri = tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined;
            if (uri && !shownInTab(uri)) forget(uri);
        }))
    );
    void vscode.commands.executeCommand('setContext', 'allyproof.aiAvailable', aiAvailable());
    if (lmAvailable) {
        context.subscriptions.push(
            vscode.lm.onDidChangeChatModels(() => void aiReview.showIdle()),
            vscode.lm.registerTool('a11y_check', new A11yCheckTool(CHECK_LANGUAGES, document => check.checkFor(document)))
        );
    }

    check.start(context.asAbsolutePath('dist/worker.mjs'), log);
    vscode.window.visibleTextEditors.forEach(editor => void runDiagnostics(editor.document));
    if (context.extensionMode === vscode.ExtensionMode.Test) {
        return { findings: tree, findingsStatus: tree.status, aiReviewStatus: aiReview.status };
    }
}

function shownInTab(uri: vscode.Uri): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()));
}

// TypeScript files only while they hold an Angular component, as the Check's own gate decides
function checked(document: vscode.TextDocument): boolean {
    return SUPPORTED_LANGUAGES.includes(document.languageId) && isChecked({ languageId: document.languageId, text: document.getText() });
}

async function checkDocument(check: CheckDiagnostics, document: vscode.TextDocument, log: vscode.LogOutputChannel): Promise<void> {
    if (!SUPPORTED_LANGUAGES.includes(document.languageId)) return;
    // A file that no longer holds a component keeps no Findings
    if (!checked(document)) return check.delete(document.uri);
    try {
        await check.update(document);
    } catch (error) {
        log.error(`Check failed: ${logText(error instanceof Error ? error.message : String(error))}`);
        check.delete(document.uri);
    }
}

export function deactivate(): void {}
