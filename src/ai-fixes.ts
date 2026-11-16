import * as vscode from 'vscode';
import { checkLanguageId, type Finding } from './core/analysis';
import { logText } from './core/log-text';
import { CHECK_SOURCE, codeOf } from './check-diagnostics';
import { AI_SOURCE } from './ai-review-ui';
import { diagnosticMessage } from './learn-hover';
import { fixTarget, FixTarget, locate, proposeFix } from './review/ai-fix';
import { ModelError, ModelPort } from './review/ai-review';

const SCHEME = 'allyproof-fix';

/** What the AI fix code action hands to `allyproof.fixWithAI`. */
export interface FixWithAIArgument {
    uri: string;
    finding: Pick<Finding, 'criteria' | 'message' | 'explanation'>;
    target: FixTarget;
}

/** The text a layer reported its Findings on, and the Findings. */
interface Report {
    text: string;
    findings: Finding[];
}

/**
 * Offers an AI fix for each Finding as a quick fix that is never preferred, and shows it as a diff to accept or
 * discard once the Check verified it.
 */
export class AIFixes implements vscode.CodeActionProvider, vscode.Disposable {
    static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };
    // The proposed text of each open diff
    private readonly proposals = new Map<string, string>();
    private readonly provider = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        provideTextDocumentContent: uri => this.proposals.get(uri.toString())
    });
    private proposalCount = 0;

    constructor(private readonly ports: {
        aiAvailable(): boolean;
        /** Whether the Check analyses the document. */
        reviews(document: vscode.TextDocument): boolean;
        checkReport(uri: vscode.Uri): Report | undefined;
        aiReport(uri: vscode.Uri): Report | undefined;
        /** The model after the provider notice, or undefined. */
        model(signal: AbortSignal): Promise<ModelPort | undefined>;
        skill(): Promise<string>;
        /** The Check of exactly this text, undefined when it could not run. */
        verify(document: { languageId: string; text: string }, scope: vscode.Uri): Promise<Finding[] | undefined>;
        log: vscode.LogOutputChannel;
    }) {}

    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        if (!this.ports.aiAvailable() || !this.ports.reviews(document)) return [];
        if (context.only && !context.only.contains(vscode.CodeActionKind.QuickFix)) return [];
        const text = document.getText();
        return context.diagnostics.flatMap(diagnostic => {
            const found = this.findingOf(document, text, diagnostic);
            if (!found) return [];
            const action = new vscode.CodeAction('Fix with AI (review the diff first)', vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            // The lightbulb shortcut applies deterministic fixes only
            action.isPreferred = false;
            const { criteria, message, explanation } = found.finding;
            const argument: FixWithAIArgument = { uri: document.uri.toString(), finding: { criteria, message, explanation }, target: found.target };
            action.command = { title: action.title, command: 'allyproof.fixWithAI', arguments: [argument] };
            return [action];
        });
    }

    async fix(argument: FixWithAIArgument): Promise<void> {
        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === argument.uri);
        if (!document) return;
        if (!locate(argument.target, document.getText())) return refused('the code changed since the Finding was reported');
        const version = document.version;
        const reviewed = { languageId: checkLanguageId(document.languageId, document.fileName), text: document.getText() };
        let outcome: Awaited<ReturnType<typeof proposeFix>> | undefined;
        try {
            outcome = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Allyproof: preparing an AI fix…', cancellable: true },
                async (_progress, token) => {
                    const controller = new AbortController();
                    token.onCancellationRequested(() => controller.abort());
                    const model = await this.ports.model(controller.signal);
                    if (!model) return undefined;
                    return proposeFix(
                        { document: reviewed, finding: argument.finding, target: argument.target },
                        {
                            model,
                            skill: { text: await this.ports.skill() },
                            check: checked => this.ports.verify(checked, document.uri),
                            signal: controller.signal
                        }
                    );
                }
            );
        } catch (error) {
            if (error instanceof ModelError && error.code === 'Cancelled') return;
            const text = logText(error instanceof Error ? error.message : String(error));
            this.ports.log.error(`AI fix failed: ${error instanceof ModelError ? `${error.code}: ${text}` : text}`);
            void vscode.window.showWarningMessage(`Allyproof could not prepare an AI fix: ${text}`);
            return;
        }
        if (!outcome) return;
        if (outcome.status === 'refused') return refused('the code changed since the Finding was reported');
        if (outcome.status !== 'proposed') {
            void vscode.window.showWarningMessage(`Allyproof discarded the AI fix. ${outcome.reason}`);
            return;
        }
        if (document.isClosed || document.version !== version) return refused('the file changed while the fix was prepared');
        await this.preview(document, version, outcome);
    }

    dispose(): void {
        this.provider.dispose();
        this.proposals.clear();
    }

    // The diff, then a dialog to apply or discard it; the AI explanation is only ever shown as plain dialog text
    private async preview(
        document: vscode.TextDocument,
        version: number,
        proposal: { edit: { range: { start: number; end: number }; newText: string }; text: string; explanation: string }
    ): Promise<void> {
        const proposed = vscode.Uri.from({ scheme: SCHEME, path: document.uri.path, query: String(++this.proposalCount) });
        this.proposals.set(proposed.toString(), proposal.text);
        try {
            const name = document.uri.path.split('/').pop() ?? 'file';
            await vscode.commands.executeCommand('vscode.diff', document.uri, proposed, `${name} ↔ AI fix`, { preview: true });
            const answer = await vscode.window.showInformationMessage(
                'Apply the AI fix shown in the diff?',
                { modal: true, detail: `${proposal.explanation}\n\nThe Check found no new Findings in the fixed code.` },
                'Apply Fix'
            );
            if (answer !== 'Apply Fix') return;
            if (document.isClosed || document.version !== version) return refused('the file changed while the fix was shown');
            const edit = new vscode.WorkspaceEdit();
            const { range, newText } = proposal.edit;
            edit.replace(document.uri, new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)), newText);
            await vscode.workspace.applyEdit(edit);
        } finally {
            await closeDiff(proposed);
            this.proposals.delete(proposed.toString());
        }
    }

    // The reported Finding behind a Check or AI diagnostic whose lines still read as they did when it was reported
    private findingOf(document: vscode.TextDocument, text: string, diagnostic: vscode.Diagnostic): { finding: Finding; target: FixTarget } | undefined {
        const ai = diagnostic.source === AI_SOURCE;
        const report = ai ? this.ports.aiReport(document.uri) : diagnostic.source === CHECK_SOURCE ? this.ports.checkReport(document.uri) : undefined;
        if (!report) return undefined;
        const line = diagnostic.range.start.line;
        for (const finding of report.findings) {
            const same = ai ? diagnostic.message.startsWith(finding.message) : codeOf(diagnostic) === finding.ruleId && diagnostic.message === diagnosticMessage(finding);
            if (!same) continue;
            const target = fixTarget(report.text, finding.range);
            const at = locate(target, text);
            if (!at) continue;
            // Where the lines are now, or were when the diagnostic was set
            const now = [document.positionAt(at.start).line, document.positionAt(at.end).line];
            const then = [lineOf(report.text, target.range.start), lineOf(report.text, target.range.end)];
            if ((now[0] <= line && line <= now[1]) || (then[0] <= line && line <= then[1])) return { finding, target };
        }
        return undefined;
    }
}

function lineOf(text: string, offset: number): number {
    return text.slice(0, offset).split('\n').length - 1;
}

function refused(why: string): void {
    void vscode.window.showWarningMessage(`Allyproof refused the AI fix: ${why}. Check the file or run AI Review again, then retry.`);
}

async function closeDiff(proposed: vscode.Uri): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
        tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === proposed.toString());
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs);
}
