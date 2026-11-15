import * as vscode from 'vscode';
import { AnalysisWorker } from './analysis-worker';
import { Finding } from './core/analysis';
import { criterionName, criterionUrl } from './core/wcag';

export const CHECK_SOURCE = 'Allyproof';

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information
};

interface Reported {
    range: vscode.Range;
    finding: Finding;
}

/** Shows Check Findings as diagnostics and explains them on hover; a paused Check keeps the last ones. */
export class CheckDiagnostics implements vscode.HoverProvider, vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('allyproof');
    private readonly reported = new Map<string, Reported[]>();
    private worker: AnalysisWorker | undefined;
    // Why the Check is paused, per document
    private readonly paused = new Map<string, string>();
    // Documents whose Check missed its deadline are checked on save only: never with unsaved changes
    private readonly onSaveOnly = new Set<string>();
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    private readonly activeEditorChange = vscode.window.onDidChangeActiveTextEditor(() => this.showPaused());

    /** Starts the analysis worker from its bundled script; the worker thread spawns on the first Check. */
    start(workerScript: string): void {
        this.worker = new AnalysisWorker(workerScript);
    }

    async update(document: vscode.TextDocument): Promise<void> {
        const uri = document.uri.toString();
        if (!this.worker || (document.isDirty && this.onSaveOnly.has(uri))) return;
        const version = document.version;
        const outcome = await this.worker.check(uri, { languageId: document.languageId, text: document.getText() });
        if (outcome.status === 'dropped' || document.isClosed || document.version !== version) return;
        if (outcome.status === 'paused') {
            if (outcome.deadlineExceeded) this.onSaveOnly.add(uri);
            this.paused.set(uri, outcome.reason);
            this.showPaused();
            return;
        }
        this.paused.delete(uri);
        this.showPaused();
        const { findings } = outcome.result;

        const reported = findings.map(finding => ({
            range: new vscode.Range(document.positionAt(finding.range.start), document.positionAt(finding.range.end)),
            finding
        }));
        this.reported.set(document.uri.toString(), reported);
        this.collection.set(document.uri, reported.map(({ range, finding }) => toDiagnostic(range, finding)));
    }

    delete(uri: vscode.Uri): void {
        this.reported.delete(uri.toString());
        this.paused.delete(uri.toString());
        this.onSaveOnly.delete(uri.toString());
        this.collection.delete(uri);
        this.showPaused();
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const hits = (this.reported.get(document.uri.toString()) ?? []).filter(r => r.range.contains(position));
        if (hits.length === 0) return undefined;
        return new vscode.Hover(hits.map(({ finding }) => explain(finding)), hits[0].range);
    }

    dispose(): void {
        this.worker?.dispose();
        this.activeEditorChange.dispose();
        this.status.dispose();
        this.collection.dispose();
        this.reported.clear();
    }

    // A paused Check must never read as "no Findings", so the active document's pause stays visible
    private showPaused(): void {
        const uri = vscode.window.activeTextEditor?.document.uri.toString();
        const reason = uri === undefined ? undefined : this.paused.get(uri);
        if (reason === undefined) return this.status.hide();
        this.status.text = '$(debug-pause) Check paused';
        this.status.tooltip = reason;
        this.status.accessibilityInformation = { label: `Check paused: ${reason}` };
        this.status.show();
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
