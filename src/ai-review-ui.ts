import * as vscode from 'vscode';
import { checkLanguageId, type AnalysisDocument, type Finding } from './core/analysis';
import { criterionUrl } from './core/wcag';
import { selectCopilotModel } from './copilot-model';
import { GateReport, ModelError, ModelPort, ReviewCache, review } from './review/ai-review';
import { LocalModelSettings, selectLocalModel } from './review/local-model';

export const AI_SOURCE = 'Allyproof AI';
const SKILL_PATH = ['skills', 'allyproof', 'SKILL.md'];
const CACHE_KEY = 'allyproof.aiReview.cache';
// The oldest entries go once the cache is full, so entries of an earlier Skill or model cannot pile up
const CACHE_ENTRIES = 1000;
// Per provider, so switching to another provider shows the notice again
const noticeKey = (provider: Provider) => `allyproof.aiReview.noticeShown.${provider}`;

type Provider = 'copilot' | 'local';

/** Runs the AI Review on user action and shows its progress, result and Findings. */
export class AIReview implements vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('allyproof-ai');
    readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    private readonly cache = storedCache(this.context.workspaceState);
    private running: AbortController | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        /** Whether the Check analyses the document, which the AI Review then reviews too. */
        private readonly reviews: (document: vscode.TextDocument) => boolean,
        /** Check Findings of exactly the reviewed text, so their offsets match the AI Findings'. */
        private readonly checkFindings: (document: AnalysisDocument, scope: vscode.Uri) => Promise<Finding[]>,
        /** Mirrors the AI diagnostics in the Findings tree: shows the AI Findings beside the Check's, or clears them. */
        private readonly tree: {
            setAI(document: vscode.TextDocument, findings: Finding[]): void;
            deleteAI(uri: vscode.Uri): void;
        }
    ) {
        this.status.name = 'Allyproof AI Review';
        void this.showIdle();
    }

    /** Reflects whether a model is available; call when the models change. */
    async showIdle(): Promise<void> {
        if (this.running) return;
        const local = provider() === 'local';
        // Without the language model API (some VS Code forks) only a local model can review
        if (!local && typeof vscode.lm?.registerTool !== 'function') return this.status.hide();
        // A local server is only contacted when the user starts a review
        if (usesLocalModel() || (!local && await selectCopilotModel())) {
            this.show('$(sparkle) AI Review', 'Start AI Review of the current file or selection', 'allyproof.startAIReview');
        } else if (!vscode.workspace.isTrusted) {
            this.show('$(workspace-untrusted) AI Review disabled', 'Trust this workspace to enable AI Review.', 'workbench.trust.manage');
        } else {
            this.show('$(sparkle) Set up AI Review', 'AI Review uses GitHub Copilot. Install it to enable AI Review.', {
                title: 'Set up AI Review',
                command: 'workbench.extensions.search',
                arguments: ['GitHub.copilot-chat']
            });
        }
    }

    async start(document = vscode.window.activeTextEditor?.document): Promise<void> {
        if (this.running || !document || !this.reviews(document)) return;
        const chosen = provider();
        // An untrusted workspace never falls back to Copilot when the user chose a local model
        if (chosen === 'local' && !usesLocalModel()) return this.showIdle();
        let model: ModelPort | undefined;
        if (chosen === 'local') {
            // The lookup can be cancelled like the review itself
            const lookup = this.running = new AbortController();
            this.show('$(loading~spin) AI Review…', 'Connecting to the local model server. Click to cancel.', 'allyproof.cancelAIReview');
            try {
                model = await selectLocalModel(localSettings(), { signal: lookup.signal });
            } catch (error) {
                const cancelled = error instanceof ModelError && error.code === 'Cancelled';
                return this.show(`$(warning) AI Review ${cancelled ? 'cancelled' : 'failed'}`, describe(error), 'allyproof.startAIReview');
            } finally {
                this.running = undefined;
            }
        } else {
            model = await selectCopilotModel();
        }
        if (!model) return this.showIdle();
        if (!this.context.globalState.get(noticeKey(chosen)) && !await this.acceptNotice(model, chosen)) return;

        const running = this.running = new AbortController();
        const version = document.version;
        const editor = vscode.window.activeTextEditor;
        const selection = editor?.document === document && !editor.selection.isEmpty
            ? { start: document.offsetAt(editor.selection.start), end: document.offsetAt(editor.selection.end) }
            : undefined;
        this.show('$(loading~spin) AI Review…', `Reviewing with ${model.name}. Click to cancel.`, 'allyproof.cancelAIReview');
        try {
            const reviewed = { languageId: checkLanguageId(document.languageId, document.fileName), text: document.getText() };
            const { findings, gate } = await review(
                { document: reviewed, checkFindings: await this.checkFindings(reviewed, document.uri), selection },
                {
                    model,
                    skill: { text: await this.readSkill() },
                    cache: this.cache,
                    signal: running.signal,
                    onFindings: found => this.showFindings(document, version, found)
                }
            );
            // Also when every region came from the cache without Findings
            this.showFindings(document, version, findings);
            this.show(`$(sparkle) AI: ${findings.length} ${findings.length === 1 ? 'Finding' : 'Findings'}`, summary(gate, model), 'allyproof.startAIReview');
        } catch (error) {
            const message = describe(error, model);
            this.show(`$(warning) AI Review ${error instanceof ModelError && error.code === 'Cancelled' ? 'cancelled' : 'failed'}`, message, 'allyproof.startAIReview');
        } finally {
            this.running = undefined;
        }
    }

    async clearCache(): Promise<void> {
        await this.cache.clear();
        vscode.window.setStatusBarMessage('Allyproof: AI Review cache cleared.', 3000);
    }

    cancel(): void {
        this.running?.abort();
    }

    /** Auto review is an opt-in setting and only runs after the user accepted the provider notice. */
    reviewOnSave(document: vscode.TextDocument): void {
        const auto = vscode.workspace.getConfiguration('allyproof').get<boolean>('aiReview.auto', false);
        if (auto && this.context.globalState.get(noticeKey(provider())) && document === vscode.window.activeTextEditor?.document) {
            void this.start(document);
        }
    }

    delete(uri: vscode.Uri): void {
        this.collection.delete(uri);
        this.tree.deleteAI(uri);
    }

    dispose(): void {
        this.running?.abort();
        this.collection.dispose();
        this.status.dispose();
    }

    private showFindings(document: vscode.TextDocument, version: number, findings: Finding[]): void {
        if (document.isClosed || document.version !== version) return;
        this.collection.set(document.uri, findings.map(f => toDiagnostic(document, f)));
        this.tree.setAI(document, findings);
    }

    // Shown once per provider, before any code goes to that provider for the first time
    private async acceptNotice(model: ModelPort, chosen: Provider): Promise<boolean> {
        const answer = await vscode.window.showInformationMessage(
            'AI Review sends the code of the current file to the AI provider.',
            { modal: true, detail: `Provider: ${model.name}. The review only runs when you start it.` },
            'Start AI Review'
        );
        if (answer !== 'Start AI Review') return false;
        await this.context.globalState.update(noticeKey(chosen), true);
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

function provider(): Provider {
    return vscode.workspace.getConfiguration('allyproof').get<Provider>('aiReview.provider', 'copilot') === 'local' ? 'local' : 'copilot';
}

// An untrusted workspace cannot redirect code to another endpoint, so it gets no local model; AI Review is then
// disabled rather than sending the code to Copilot instead
function usesLocalModel(): boolean {
    return vscode.workspace.isTrusted && provider() === 'local';
}

function localSettings(): LocalModelSettings {
    const settings = vscode.workspace.getConfiguration('allyproof');
    return {
        endpoint: settings.get<string>('aiReview.localEndpoint', 'http://localhost:1234/v1'),
        model: settings.get<string>('aiReview.localModel', '')
    };
}

// In workspace storage, so it survives a restart
function storedCache(state: vscode.Memento): ReviewCache & { clear(): Thenable<void> } {
    const entries = () => state.get<Record<string, Finding[]>>(CACHE_KEY, {});
    return {
        get: key => entries()[key],
        set: (key, findings) => {
            const kept = { ...entries() };
            delete kept[key];
            kept[key] = findings;
            const keys = Object.keys(kept);
            keys.slice(0, keys.length - CACHE_ENTRIES).forEach(old => delete kept[old]);
            void state.update(CACHE_KEY, kept);
        },
        clear: () => state.update(CACHE_KEY, undefined)
    };
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

// What the Relevance Gate sent and skipped, for example "3 of 12 regions reviewed, 9 unchanged."
function summary(gate: GateReport, model: ModelPort): string {
    const skipped = [
        gate.unchanged > 0 && `${gate.unchanged} unchanged`,
        gate.noMarkup > 0 && `${gate.noMarkup} without markup`
    ].filter(Boolean).join(', ');
    const reviewed = gate.reviewed === 0 && gate.unchanged === 0
        ? 'No markup to review.'
        : `${gate.reviewed} of ${gate.regions} ${gate.regions === 1 ? 'region' : 'regions'} reviewed${skipped && `, ${skipped}`}.`;
    return `${reviewed} Model: ${model.name}. Click to review again.`;
}

function describe(error: unknown, model?: ModelPort): string {
    if (!(error instanceof ModelError)) return error instanceof Error ? error.message : String(error);
    if (!model) return `${error.message} Click to try again.`;
    switch (error.code) {
        case 'NoPermissions': return `Allyproof may not use ${model.name}. Allow it when VS Code asks, then start AI Review again.`;
        case 'Blocked': return `${model.name} blocked the request, probably a rate limit. Try again later.`;
        case 'NotFound': return `${model.name} is no longer available. Start AI Review again to pick another model.`;
        case 'Cancelled': return 'Click to start AI Review again.';
        default: return `${error.message} Click to try again.`;
    }
}
