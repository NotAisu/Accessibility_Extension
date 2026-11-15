import * as vscode from 'vscode';
import { AnalysisWorker, CheckOutcome } from './analysis-worker';
import { AnalysisDocument, Finding } from './core/analysis';
import { criterionName, criterionUrl } from './core/wcag';
import type { FindingsTree } from './findings-tree';

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

/** Shows Check Findings as diagnostics and explains them on hover; a paused Check keeps the last ones. */
export class CheckDiagnostics implements vscode.HoverProvider, vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('allyproof');
    private readonly reported = new Map<string, { version: number; findings: Reported[] }>();
    private worker: AnalysisWorker | undefined;
    // Documents whose Check missed its deadline are checked on save only: never with unsaved changes
    private readonly onSaveOnly = new Set<string>();
    private agentRequests = 0;

    constructor(private readonly tree: FindingsTree) {}

    /** Starts the analysis worker from its bundled script; the worker thread spawns on the first Check. */
    start(workerScript: string): void {
        this.worker = new AnalysisWorker(workerScript);
    }

    async update(document: vscode.TextDocument): Promise<void> {
        const uri = document.uri.toString();
        if (!this.worker || (document.isDirty && this.onSaveOnly.has(uri))) return;
        const version = document.version;
        const outcome = await this.worker.check(uri, { languageId: document.languageId, text: document.getText() });
        // A missed deadline counts even when the document changed meanwhile
        if (outcome.status === 'paused' && outcome.deadlineExceeded) this.onSaveOnly.add(uri);
        if (outcome.status === 'dropped' || document.isClosed || document.version !== version) return;
        if (outcome.status === 'paused') return this.tree.setPaused(document.uri, outcome.reason);
        this.tree.setCheck(document, outcome.result);
        const { findings } = outcome.result;

        const reported = findings.map(finding => ({
            range: new vscode.Range(document.positionAt(finding.range.start), document.positionAt(finding.range.end)),
            finding
        }));
        this.reported.set(document.uri.toString(), { version, findings: reported });
        this.collection.set(document.uri, reported.map(({ range, finding }) => toDiagnostic(range, finding)));
    }

    /** Check Findings of exactly this text, for the AI Review; none while the Check is paused. */
    async findingsOf(document: AnalysisDocument): Promise<Finding[]> {
        // Its own request key, so it never drops or is dropped by the document's own Check
        const outcome = await this.worker?.check(`ai-review:${document.languageId}`, document);
        return outcome?.status === 'done' ? outcome.result.findings : [];
    }

    /** The Check of exactly this text for an agent; every call has its own request key, so none drops another. */
    async checkFor(document: AnalysisDocument): Promise<CheckOutcome> {
        if (!this.worker) return { status: 'paused', reason: 'The Check has not started yet', deadlineExceeded: false };
        return this.worker.check(`a11y-check:${++this.agentRequests}`, document);
    }

    /** Findings with a fix, only while their offsets still match the document's text. */
    fixable(document: vscode.TextDocument): Reported[] {
        const reported = this.reported.get(document.uri.toString());
        if (!reported || reported.version !== document.version) return [];
        return reported.findings.filter(({ finding }) => finding.fix);
    }

    delete(uri: vscode.Uri): void {
        this.reported.delete(uri.toString());
        this.onSaveOnly.delete(uri.toString());
        this.collection.delete(uri);
        this.tree.deleteCheck(uri);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const hits = (this.reported.get(document.uri.toString())?.findings ?? []).filter(r => r.range.contains(position));
        if (hits.length === 0) return undefined;
        return new vscode.Hover(hits.map(({ finding }) => explain(finding)), hits[0].range);
    }

    dispose(): void {
        this.worker?.dispose();
        this.collection.dispose();
        this.reported.clear();
    }
}

function toDiagnostic(range: vscode.Range, finding: Finding): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
        range,
        `${finding.message} (WCAG ${finding.criteria.join(', ')})`,
        SEVERITY[finding.severity]
    );
    diagnostic.source = CHECK_SOURCE;
    diagnostic.code = { value: finding.ruleId, target: vscode.Uri.parse(finding.helpUrl) };
    return diagnostic;
}

function explain(finding: Finding): vscode.MarkdownString {
    const criteria = finding.criteria
        .map(c => `[WCAG ${c} ${criterionName(c)}](${criterionUrl(c)})`)
        .join(' · ');
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${escape(finding.message)}**\n\n`);
    markdown.appendText(finding.explanation);
    markdown.appendMarkdown(`\n\n${criteria} · [Rule ${escape(finding.ruleId)}](${finding.helpUrl})`);
    return markdown;
}

function escape(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
