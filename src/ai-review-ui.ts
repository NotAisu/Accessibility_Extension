import * as vscode from 'vscode';
import type { AnalysisDocument, Finding } from './core/analysis';
import { criterionUrl } from './core/wcag';
import { selectCopilotModel } from './copilot-model';
import { GateReport, ModelError, ModelPort, ReviewCache, review } from './review/ai-review';

export const AI_SOURCE = 'Allyproof AI';
const SKILL_PATH = ['skills', 'allyproof', 'SKILL.md'];
const NOTICE_KEY = 'allyproof.aiReview.noticeShown';

/** Runs the AI Review on user action and shows its progress, result and Findings. */
export class AIReview implements vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('allyproof-ai');
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    // In memory for now; the persistent cache comes with the Relevance Gate (#19)
    private readonly cache = memoryCache();
    private running: AbortController | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly languages: string[],
        /** Check Findings of exactly the reviewed text, so their offsets match the AI Findings'. */
        private readonly checkFindings: (document: AnalysisDocument) => Promise<Finding[]>
    ) {
        this.status.name = 'Allyproof AI Review';
        void this.showIdle();
    }

    /** Reflects whether a model is available; call when the models change. */
    async showIdle(): Promise<void> {
        if (this.running) return;
        // Editors without the language model API (some VS Code forks) cannot set up an AI Review at all
        if (typeof vscode.lm?.registerTool !== 'function') return this.status.hide();
        if (await selectCopilotModel()) {
            this.show('$(sparkle) AI Review', 'Start AI Review of the current file', 'allyproof.startAIReview');
        } else {
            this.show('$(sparkle) Set up AI Review', 'AI Review uses GitHub Copilot. Install it to enable AI Review.', {
                title: 'Set up AI Review',
                command: 'workbench.extensions.search',
                arguments: ['GitHub.copilot-chat']
            });
        }
    }

    async start(document = vscode.window.activeTextEditor?.document): Promise<void> {
        if (this.running || !document || !this.languages.includes(document.languageId)) return;
        const model = await selectCopilotModel();
        if (!model) return this.showIdle();
        if (!this.context.globalState.get(NOTICE_KEY) && !await this.acceptNotice(model)) return;

        const running = this.running = new AbortController();
        const version = document.version;
        this.show('$(loading~spin) AI Review…', `Reviewing with ${model.name}. Click to cancel.`, 'allyproof.cancelAIReview');
        try {
            const reviewed = { languageId: document.languageId, text: document.getText() };
            const { findings, gate } = await review(
                { document: reviewed, checkFindings: await this.checkFindings(reviewed) },
                {
                    model,
                    skill: { text: await this.readSkill() },
                    cache: this.cache,
                    signal: running.signal,
                    onFindings: found => {
                        if (!document.isClosed && document.version === version) this.collection.set(document.uri, found.map(f => toDiagnostic(document, f)));
                    }
                }
            );
            this.show(`$(sparkle) AI: ${findings.length} ${findings.length === 1 ? 'Finding' : 'Findings'}`, summary(gate, model), 'allyproof.startAIReview');
        } catch (error) {
            const message = describe(error, model);
            this.show(`$(warning) AI Review ${error instanceof ModelError && error.code === 'Cancelled' ? 'cancelled' : 'failed'}`, message, 'allyproof.startAIReview');
        } finally {
            this.running = undefined;
        }
    }

    cancel(): void {
        this.running?.abort();
    }

    /** Auto review is an opt-in setting and only runs after the user accepted the provider notice. */
    reviewOnSave(document: vscode.TextDocument): void {
        const auto = vscode.workspace.getConfiguration('allyproof').get<boolean>('aiReview.auto', false);
        if (auto && this.context.globalState.get(NOTICE_KEY) && document === vscode.window.activeTextEditor?.document) {
            void this.start(document);
        }
    }

    delete(uri: vscode.Uri): void {
        this.collection.delete(uri);
    }

    dispose(): void {
        this.running?.abort();
        this.collection.dispose();
        this.status.dispose();
    }

    // Shown once, before any code leaves the machine for the first time
    private async acceptNotice(model: ModelPort): Promise<boolean> {
        const answer = await vscode.window.showInformationMessage(
            'AI Review sends the code of the current file to the AI provider.',
            { modal: true, detail: `Provider: ${model.name}. The review only runs when you start it.` },
            'Start AI Review'
        );
        if (answer !== 'Start AI Review') return false;
        await this.context.globalState.update(NOTICE_KEY, true);
        return true;
    }

    private async readSkill(): Promise<string> {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.context.extensionUri, ...SKILL_PATH));
        return new TextDecoder().decode(bytes);
    }

    private show(text: string, tooltip: string, command: string | vscode.Command): void {
        this.status.text = text;
        this.status.tooltip = tooltip;
        this.status.command = command;
        this.status.accessibilityInformation = { label: `${text.replace(/\$\([^)]*\)\s*/g, '')}. ${tooltip}` };
        this.status.show();
    }
}

function memoryCache(): ReviewCache {
    const entries = new Map<string, Finding[]>();
    return { get: key => entries.get(key), set: (key, findings) => void entries.set(key, findings) };
}

// AI text reaches the user only as plain diagnostic text, never as Markdown or HTML
function toDiagnostic(document: vscode.TextDocument, finding: Finding): vscode.Diagnostic {
    const [criterion] = finding.criteria;
    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(document.positionAt(finding.range.start), document.positionAt(finding.range.end)),
        `${finding.message} ${finding.explanation} (WCAG ${criterion})`,
        vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = AI_SOURCE;
    diagnostic.code = { value: 'AI', target: vscode.Uri.parse(criterionUrl(criterion)) };
    return diagnostic;
}

function summary(gate: GateReport, model: ModelPort): string {
    const reviewed = gate.unchanged === gate.regions
        ? 'Unchanged since the last review, served from it.'
        : `${gate.reviewed} of ${gate.regions} regions reviewed, ${gate.unchanged} unchanged.`;
    return `${reviewed} Model: ${model.name}. Click to review again.`;
}

function describe(error: unknown, model: ModelPort): string {
    if (!(error instanceof ModelError)) return error instanceof Error ? error.message : String(error);
    switch (error.code) {
        case 'NoPermissions': return `Allyproof may not use ${model.name}. Allow it when VS Code asks, then start AI Review again.`;
        case 'Blocked': return `${model.name} blocked the request, probably a rate limit. Try again later.`;
        case 'NotFound': return `${model.name} is no longer available. Start AI Review again to pick another model.`;
        case 'Cancelled': return 'Click to start AI Review again.';
        default: return `${error.message} Click to try again.`;
    }
}
