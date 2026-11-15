import * as vscode from 'vscode';
import { analyse, Finding } from './core/analysis';
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

/** Shows Check Findings as diagnostics and explains them on hover. */
export class CheckDiagnostics implements vscode.HoverProvider, vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('allyproof');
    private readonly reported = new Map<string, Reported[]>();

    async update(document: vscode.TextDocument): Promise<void> {
        const version = document.version;
        const { findings } = await analyse({ languageId: document.languageId, text: document.getText() });
        if (document.isClosed || document.version !== version) return;

        const reported = findings.map(finding => ({
            range: new vscode.Range(document.positionAt(finding.range.start), document.positionAt(finding.range.end)),
            finding
        }));
        this.reported.set(document.uri.toString(), reported);
        this.collection.set(document.uri, reported.map(({ range, finding }) => toDiagnostic(range, finding)));
    }

    findings(uri: vscode.Uri): Finding[] {
        return (this.reported.get(uri.toString()) ?? []).map(r => r.finding);
    }

    delete(uri: vscode.Uri): void {
        this.reported.delete(uri.toString());
        this.collection.delete(uri);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const hits = (this.reported.get(document.uri.toString()) ?? []).filter(r => r.range.contains(position));
        if (hits.length === 0) return undefined;
        return new vscode.Hover(hits.map(({ finding }) => explain(finding)), hits[0].range);
    }

    dispose(): void {
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
