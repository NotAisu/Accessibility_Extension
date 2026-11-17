import * as vscode from 'vscode';
import { AnalysisWorker, CheckOutcome, EngineUsage, WorkerLog } from './analysis-worker';
import { CheckSchedule } from './check-schedule';
import { AnalysisDocument, AnalysisOptions, checkLanguageId, Finding, RuleSetting } from './core/analysis';
import type { FindingsTree } from './findings-tree';
import { diagnosticMessage, HOVER_COMMANDS, learnMarkdown } from './learn-hover';

export const CHECK_SOURCE = 'Allyproof';

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information
};

export interface Reported {
    range: vscode.Range;
    finding: Finding;
}

/** Shows Check Findings as diagnostics and teaches them on hover; a paused Check keeps the last ones. */
export class CheckDiagnostics implements vscode.HoverProvider, vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('allyproof');
    private readonly reported = new Map<string, { version: number; text: string; findings: Reported[] }>();
    private worker: AnalysisWorker | undefined;
    private readonly schedule = new CheckSchedule();
    private agentRequests = 0;

    constructor(private readonly tree: FindingsTree, private readonly aiAvailable: () => boolean) {}

    /** Starts the analysis worker from its bundled script; the worker thread spawns on the first Check. */
    start(workerScript: string, log: WorkerLog): void {
        this.worker = new AnalysisWorker(workerScript, { log });
    }

    /** The engines run in this session and those paused, for an issue report. */
    engines(): EngineUsage {
        return this.worker?.engines() ?? { used: [], paused: [] };
    }

    async update(document: vscode.TextDocument): Promise<void> {
        const uri = document.uri.toString();
        if (!this.worker || !this.schedule.mayCheck(uri, { unsaved: document.isDirty })) return;
        const version = document.version;
        const text = document.getText();
        const outcome = await this.worker.check(uri, { languageId: checkLanguageId(document.languageId, document.fileName), text }, options(document));
        // How long the run took counts even when the document changed meanwhile
        this.schedule.measured(uri, outcome);
        if (outcome.status === 'dropped' || document.isClosed || document.version !== version) return;
        // The schedule now checks a file that overran its deadline on save only
        if (outcome.status === 'paused') return this.tree.setPaused(document.uri, outcome.deadlineExceeded ? `${outcome.reason}, so the file is checked on save` : outcome.reason);
        this.tree.setCheck(document, outcome.result);
        const { findings } = outcome.result;

        const reported = findings.map(finding => ({
            range: new vscode.Range(document.positionAt(finding.range.start), document.positionAt(finding.range.end)),
            finding
        }));
        this.reported.set(document.uri.toString(), { version, text, findings: reported });
        this.collection.set(document.uri, reported.map(({ range, finding }) => toDiagnostic(range, finding)));
    }

    /** Runs `check` once the document stopped changing; a document whose Check is slow waits for its save. */
    changed(document: vscode.TextDocument, check: () => void): void {
        this.schedule.changed(document.uri.toString(), check);
    }

    /** Check Findings of exactly this text of the file at `scope`, for the AI Review; none while the Check is paused. */
    async findingsOf(document: AnalysisDocument, scope: vscode.Uri): Promise<Finding[]> {
        // Its own request key, so it never drops or is dropped by the document's own Check
        const outcome = await this.worker?.check(`ai-review:${document.languageId}`, document, options(scope));
        return outcome?.status === 'done' ? outcome.result.findings : [];
    }

    /** The Check of exactly this text for an agent; every call has its own request key, so none drops another. */
    async checkFor(document: AnalysisDocument): Promise<CheckOutcome> {
        if (!this.worker) return { status: 'paused', reason: 'The Check has not started yet', deadlineExceeded: false };
        return this.worker.check(`a11y-check:${++this.agentRequests}`, document, options());
    }

    /** The Check of a file that is not open, for the workspace Check; never shown as diagnostics. */
    async checkFile(uri: vscode.Uri, document: AnalysisDocument): Promise<CheckOutcome> {
        if (!this.worker) return { status: 'paused', reason: 'The Check has not started yet', deadlineExceeded: false };
        return this.worker.check(`workspace:${uri.toString()}`, document, options(uri), { background: true });
    }

    /** The rule settings the file is checked with. */
    optionsFor(uri: vscode.Uri): AnalysisOptions {
        return options(uri);
    }

    /** The Check of exactly this text of the file at `scope`, for verifying an AI fix; undefined when it could not run. */
    async verify(document: AnalysisDocument, scope: vscode.Uri): Promise<Finding[] | undefined> {
        if (!this.worker) return undefined;
        const outcome = await this.worker.check(`ai-fix:${++this.agentRequests}`, document, options(scope));
        return outcome.status === 'done' ? outcome.result.findings : undefined;
    }

    /** The text the last Check of the file read and its Findings, for AI fixes. */
    reportOf(uri: vscode.Uri): { text: string; findings: Finding[] } | undefined {
        const reported = this.reported.get(uri.toString());
        return reported && { text: reported.text, findings: reported.findings.map(({ finding }) => finding) };
    }

    /** Whether the Findings shown are those of the document's current text. */
    isCurrent(document: vscode.TextDocument): boolean {
        return this.reported.get(document.uri.toString())?.version === document.version;
    }

    /** Findings with a fix, only while their offsets still match the document's text. */
    fixable(document: vscode.TextDocument): Reported[] {
        const reported = this.reported.get(document.uri.toString());
        if (!reported || reported.version !== document.version) return [];
        return reported.findings.filter(({ finding }) => finding.fix);
    }

    delete(uri: vscode.Uri): void {
        this.reported.delete(uri.toString());
        this.schedule.delete(uri.toString());
        this.collection.delete(uri);
        this.tree.deleteCheck(uri);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const reported = this.reported.get(document.uri.toString());
        const hits = (reported?.findings ?? []).filter(r => r.range.contains(position));
        if (!reported || hits.length === 0) return undefined;
        const languageId = checkLanguageId(document.languageId, document.fileName);
        const target = { uri: document.uri.toString(), version: reported.version, aiReviewAvailable: this.aiAvailable() };
        return new vscode.Hover(hits.map(({ finding }) => {
            const markdown = new vscode.MarkdownString(learnMarkdown(finding, languageId, target));
            // Command links run only for these commands; never `true`
            markdown.isTrusted = { enabledCommands: [...HOVER_COMMANDS] };
            return markdown;
        }), hits[0].range);
    }

    dispose(): void {
        this.schedule.dispose();
        this.worker?.dispose();
        this.collection.dispose();
        this.reported.clear();
    }
}

/** The rule id of a Check diagnostic. */
export function codeOf(diagnostic: vscode.Diagnostic): string | number | undefined {
    return typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
}

// The settings of the checked file's folder: `allyproof.rules` turns rules off or changes their severity,
// `allyproof.components` and `allyproof.polymorphicPropName` are the Component Mapping. The mapping is only ever
// read from settings, never from project files. Copied, since VS Code returns settings as proxies the worker's
// structured clone rejects
function options(scope?: vscode.ConfigurationScope): AnalysisOptions {
    const polymorphicPropName = vscode.workspace.getConfiguration('allyproof', scope).get<string>('polymorphicPropName', '');
    return {
        rules: { ...vscode.workspace.getConfiguration('allyproof', scope).get<Record<string, RuleSetting>>('rules', {}) },
        components: {
            components: { ...vscode.workspace.getConfiguration('allyproof', scope).get<Record<string, string>>('components', {}) },
            ...polymorphicPropName ? { polymorphicPropName } : {}
        }
    };
}

function toDiagnostic(range: vscode.Range, finding: Finding): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(range, diagnosticMessage(finding), SEVERITY[finding.severity]);
    diagnostic.source = CHECK_SOURCE;
    diagnostic.code = { value: finding.ruleId, target: vscode.Uri.parse(finding.helpUrl) };
    return diagnostic;
}
