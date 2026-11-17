import type { Finding, NeedsReview } from './core/analysis';
import { criterionName } from './core/wcag';

// The Findings tree, its badge and the status bar summary as plain data; findings-tree.ts shows them in VS Code

export type Filter = 'check' | 'ai-review' | 'needs-review';

export interface LocatedFinding {
    finding: Finding;
    /** 1-based line of the Finding's start. */
    line: number;
}

export interface FileFindings {
    uri: string;
    name: string;
    /** Check and AI Review Findings. */
    findings: LocatedFinding[];
    /** `line`: 1-based line of the element a likely failure points at. */
    needsReview: (NeedsReview & { line?: number })[];
    /** Why the Check is paused for this file, or why this large file is checked on save only after its Check overran the deadline; its last Findings stay. */
    status?: CheckStatus;
}

export interface CheckStatus {
    kind: 'paused' | 'checked-on-save';
    reason: string;
}

interface NodeText {
    label: string;
    description?: string;
    /** What a screen reader announces for the node. */
    accessibilityLabel: string;
    children?: TreeNode[];
    /** Starts collapsed; nodes with children start expanded otherwise. */
    collapsed?: boolean;
}

export type TreeNode = NodeText & (
    | { kind: 'file'; uri: string }
    | { kind: 'criterion'; criterion: string }
    | { kind: 'finding'; uri: string; finding: Finding; line: number }
    | { kind: 'needs-review' }
    | { kind: 'needs-review-entry'; uri: string; entry: NeedsReview; line?: number }
    | { kind: 'paused'; reason: string }
    | { kind: 'checked-on-save' }
);

export function findingsTree(files: FileFindings[], filters: ReadonlySet<Filter>): TreeNode[] {
    return files
        .map((file): TreeNode => {
            const children = fileChildren(file, filters);
            const findings = children.filter(node => node.kind === 'criterion').reduce((sum, node) => sum + node.children!.length, 0);
            const parts = [file.name, count(findings, 'Finding')];
            if (file.status) parts.push(file.status.kind === 'paused' ? 'Check paused' : 'checked on save');
            if (filters.has('needs-review') && file.needsReview.length > 0) parts.push(`${file.needsReview.length} Needs Review`);
            return { kind: 'file', uri: file.uri, label: file.name, accessibilityLabel: parts.join(', '), children };
        })
        .filter(node => node.children!.length > 0);
}

function fileChildren(file: FileFindings, filters: ReadonlySet<Filter>): TreeNode[] {
    const findings = file.findings.filter(({ finding }) => filters.has(finding.layer));
    const children = byCriterion(file.uri, findings);
    // A paused Check must never read as "no Findings", so it shows whatever the filters
    if (file.status?.kind === 'paused') {
        const { reason } = file.status;
        children.unshift({
            kind: 'paused',
            reason,
            label: 'Check paused',
            description: reason,
            accessibilityLabel: `Check paused: ${reason}. The last Findings stay.`
        });
    }
    // A large file is not a broken engine, so it reads as a schedule, not as a pause
    if (file.status?.kind === 'checked-on-save') {
        const { reason } = file.status;
        children.unshift({
            kind: 'checked-on-save',
            label: 'Checked on save',
            description: reason,
            accessibilityLabel: `Checked on save: ${onSaveDetail(reason)}`
        });
    }
    if (filters.has('needs-review') && file.needsReview.length > 0) {
        // Collapsed and never in the editor: it lists what is left to verify, not problems
        children.push({
            kind: 'needs-review',
            label: 'Needs Review',
            collapsed: true,
            accessibilityLabel: `Needs Review, ${count(criteriaCount(file), 'criterion', 'criteria')} the Check cannot decide`,
            children: file.needsReview.map(({ line, ...entry }) => ({
                kind: 'needs-review-entry',
                uri: file.uri,
                entry,
                line,
                label: `${entry.criterion} ${criterionName(entry.criterion)}`,
                description: line === undefined ? entry.reason : `Line ${line} · ${entry.reason}`,
                accessibilityLabel: `Needs Review: WCAG ${entry.criterion} ${criterionName(entry.criterion)}. ${entry.reason}`
                    + (line === undefined ? '' : `, line ${line}`)
            }))
        });
    }
    return children;
}

function byCriterion(uri: string, located: LocatedFinding[]): TreeNode[] {
    const groups = new Map<string, LocatedFinding[]>();
    for (const item of located) {
        const [criterion] = item.finding.criteria;
        groups.set(criterion, [...groups.get(criterion) ?? [], item]);
    }
    return [...groups].sort(([a], [b]) => compareCriteria(a, b)).map(([criterion, findings]) => ({
        kind: 'criterion',
        criterion,
        label: `${criterion} ${criterionName(criterion)}`,
        accessibilityLabel: `WCAG ${criterion} ${criterionName(criterion)}, ${count(findings.length, 'Finding')}`,
        children: findings.map(({ finding, line }) => ({
            kind: 'finding',
            uri,
            finding,
            line,
            label: finding.message,
            description: finding.layer === 'ai-review' ? `Line ${line} · AI` : `Line ${line}`,
            accessibilityLabel: `${LAYER_NAME[finding.layer]} Finding: ${finding.message}, line ${line}`
        }))
    }));
}

const LAYER_NAME: Record<Finding['layer'], string> = { 'check': 'Check', 'ai-review': 'AI Review' };

// One criterion can have several Needs Review entries, one per element
function criteriaCount(file: FileFindings): number {
    return new Set(file.needsReview.map(entry => entry.criterion)).size;
}

function count(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

export interface StatusSummary {
    /** With codicons. */
    text: string;
    tooltip: string;
    accessibilityLabel: string;
    /** Clicking shows the log, where the paused Check's cause is; otherwise the Findings. */
    showsLog?: true;
}

const SHOW = 'Click to show the Findings.';

/** The status bar item for the current file. */
export function statusSummary(file: FileFindings): StatusSummary {
    if (file.status?.kind === 'paused') {
        const detail = `${file.status.reason}. The last Findings stay.`;
        return {
            text: '$(debug-pause) Check paused',
            tooltip: `${detail} Click to show the log.`,
            accessibilityLabel: `Accessibility: Check paused: ${detail} Activate to show the log.`,
            showsLog: true
        };
    }
    if (file.status?.kind === 'checked-on-save') {
        const detail = onSaveDetail(file.status.reason);
        return {
            text: '$(save) Checked on save',
            tooltip: `${detail} ${SHOW}`,
            accessibilityLabel: `Accessibility: Checked on save: ${detail}`
        };
    }
    const total = file.findings.length;
    const check = file.findings.filter(({ finding }) => finding.layer === 'check').length;
    const needsReview = file.needsReview.length === 0 ? '' : ` ${count(criteriaCount(file), 'criterion Needs', 'criteria Need')} Review.`;
    const detail = (total === 0 ? 'No Findings.' : `${check} Check, ${total - check} AI Review.`) + needsReview;
    return {
        text: total === 0 ? '$(pass) No Findings' : `$(warning) ${count(total, 'Finding')}`,
        tooltip: `${detail} ${SHOW}`,
        accessibilityLabel: total === 0 ? `Accessibility: ${detail}` : `Accessibility: ${count(total, 'Finding')}, ${detail}`
    };
}

function onSaveDetail(reason: string): string {
    return `${reason}, so this large file is checked when you save. The last Findings stay.`;
}

/** The badge on the Allyproof icon: the Findings of every file, as the Problems panel counts its problems; no badge without Findings. */
export function findingsBadge(files: FileFindings[]): { value: number; tooltip: string } | undefined {
    const total = files.reduce((sum, file) => sum + file.findings.length, 0);
    return total === 0 ? undefined : { value: total, tooltip: count(total, 'Finding') };
}

// "1.4.10" after "1.4.3"
function compareCriteria(a: string, b: string): number {
    const [x, y] = [a, b].map(c => c.split('.').map(Number));
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
