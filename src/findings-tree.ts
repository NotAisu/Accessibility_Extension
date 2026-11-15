import * as vscode from 'vscode';
import type { AnalysisResult, Finding, Severity } from './core/analysis';
import { FileFindings, Filter, findingsTree, LocatedFinding, statusSummary, TreeNode } from './findings-view';

const VIEW_ID = 'allyproof.findings';

const ALL_FILTERS: { filter: Filter; label: string }[] = [
    { filter: 'check', label: 'Check' },
    { filter: 'ai-review', label: 'AI' },
    { filter: 'needs-review', label: 'Needs Review' }
];

// The Problems panel's icons, so a Check Finding reads as the diagnostic it mirrors
const SEVERITY_ICONS: Record<Severity, [icon: string, color: string]> = {
    error: ['error', 'problemsErrorIcon.foreground'],
    warning: ['warning', 'problemsWarningIcon.foreground'],
    information: ['info', 'problemsInfoIcon.foreground']
};

interface FileState {
    name: string;
    check: LocatedFinding[];
    ai: LocatedFinding[];
    needsReview: FileFindings['needsReview'];
    paused?: string;
}

/** The Findings tree and the current file's status bar summary; Needs Review is shown only here. */
export class FindingsTree implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
    private readonly files = new Map<string, FileState>();
    private readonly offered: typeof ALL_FILTERS;
    private filters: Set<Filter>;
    private readonly changed = new vscode.EventEmitter<undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
    private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    private readonly activeEditorChange = vscode.window.onDidChangeActiveTextEditor(() => this.showStatus());

    /** `aiAvailable`: whether the editor supports AI Review; without it the tree offers no AI filter. */
    constructor(aiAvailable: boolean) {
        this.offered = ALL_FILTERS.filter(({ filter }) => aiAvailable || filter !== 'ai-review');
        this.filters = new Set(this.offered.map(({ filter }) => filter));
        this.status.name = 'Allyproof Findings';
        this.status.command = `${VIEW_ID}.focus`;
    }

    setCheck(document: vscode.TextDocument, result: AnalysisResult): void {
        const state = this.state(document.uri);
        state.check = locate(document, result.findings);
        state.needsReview = result.needsReview.map(entry => entry.range
            ? { ...entry, line: document.positionAt(entry.range.start).line + 1 }
            : entry);
        state.paused = undefined;
        this.refresh();
    }

    /** The last Findings stay while the Check is paused. */
    setPaused(uri: vscode.Uri, reason: string): void {
        this.state(uri).paused = reason;
        this.refresh();
    }

    setAI(document: vscode.TextDocument, findings: Finding[]): void {
        this.state(document.uri).ai = locate(document, findings);
        this.refresh();
    }

    /** Clears the Check's Findings and Needs Review; the AI Findings follow the AI diagnostics instead. */
    deleteCheck(uri: vscode.Uri): void {
        const state = this.files.get(uri.toString());
        if (!state) return;
        Object.assign(state, { check: [], needsReview: [], paused: undefined });
        this.removeIfEmpty(uri, state);
    }

    /** Clears the AI Findings, whenever the AI diagnostics of the document are cleared. */
    deleteAI(uri: vscode.Uri): void {
        const state = this.files.get(uri.toString());
        if (!state) return;
        state.ai = [];
        this.removeIfEmpty(uri, state);
    }

    async filter(): Promise<void> {
        const picked = await vscode.window.showQuickPick(
            this.offered.map(({ filter, label }) => ({ label, filter, picked: this.filters.has(filter) })),
            { canPickMany: true, title: 'Show in the Findings tree' }
        );
        if (!picked) return;
        this.filters = new Set(picked.map(item => item.filter));
        const shown = this.offered.filter(({ filter }) => this.filters.has(filter)).map(({ label }) => label);
        this.view.description = shown.length === this.offered.length ? undefined : `Showing: ${shown.join(', ') || 'nothing'}`;
        this.changed.fire(undefined);
    }

    getChildren(node?: TreeNode): TreeNode[] {
        return node ? node.children ?? [] : findingsTree([...this.files].map(([uri, state]) => toFile(uri, state)), this.filters);
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(node.label, node.children === undefined
            ? vscode.TreeItemCollapsibleState.None
            : node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        item.description = node.description;
        item.accessibilityInformation = { label: node.accessibilityLabel };
        item.contextValue = node.kind;
        switch (node.kind) {
            case 'file':
                item.resourceUri = vscode.Uri.parse(node.uri);
                item.iconPath = vscode.ThemeIcon.File;
                break;
            case 'criterion':
                item.iconPath = new vscode.ThemeIcon('checklist');
                break;
            case 'finding': {
                const position = new vscode.Position(node.line - 1, 0);
                const [icon, color] = node.finding.layer === 'ai-review'
                    ? ['sparkle', 'list.highlightForeground']
                    : SEVERITY_ICONS[node.finding.severity];
                item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
                item.tooltip = node.finding.explanation || node.finding.message;
                item.command = {
                    title: 'Open Finding',
                    command: 'vscode.open',
                    arguments: [vscode.Uri.parse(node.uri), { selection: new vscode.Range(position, position) }]
                };
                break;
            }
            case 'needs-review':
                item.iconPath = new vscode.ThemeIcon('eye');
                break;
            case 'needs-review-entry': {
                item.iconPath = new vscode.ThemeIcon('eye');
                if (node.line === undefined) break;
                const position = new vscode.Position(node.line - 1, 0);
                item.command = {
                    title: 'Open Element',
                    command: 'vscode.open',
                    arguments: [vscode.Uri.parse(node.uri), { selection: new vscode.Range(position, position) }]
                };
                break;
            }
            case 'paused':
                item.iconPath = new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('list.warningForeground'));
                item.tooltip = node.reason;
                break;
        }
        return item;
    }

    dispose(): void {
        this.activeEditorChange.dispose();
        this.status.dispose();
        this.view.dispose();
        this.changed.dispose();
    }

    private state(uri: vscode.Uri): FileState {
        const key = uri.toString();
        let state = this.files.get(key);
        if (!state) {
            state = { name: vscode.workspace.asRelativePath(uri), check: [], ai: [], needsReview: [] };
            this.files.set(key, state);
        }
        return state;
    }

    private removeIfEmpty(uri: vscode.Uri, state: FileState): void {
        if (!state.check.length && !state.ai.length && !state.needsReview.length && state.paused === undefined) {
            this.files.delete(uri.toString());
        }
        this.refresh();
    }

    private refresh(): void {
        this.changed.fire(undefined);
        this.showStatus();
    }

    private showStatus(): void {
        const uri = vscode.window.activeTextEditor?.document.uri.toString();
        const state = uri === undefined ? undefined : this.files.get(uri);
        if (!uri || !state) return this.status.hide();
        const summary = statusSummary(toFile(uri, state));
        this.status.text = summary.text;
        this.status.tooltip = summary.tooltip;
        this.status.accessibilityInformation = { label: summary.accessibilityLabel };
        this.status.show();
    }
}

function toFile(uri: string, state: FileState): FileFindings {
    return { uri, name: state.name, findings: [...state.check, ...state.ai], needsReview: state.needsReview, paused: state.paused };
}

function locate(document: vscode.TextDocument, findings: Finding[]): LocatedFinding[] {
    return findings.map(finding => ({ finding, line: document.positionAt(finding.range.start).line + 1 }));
}
