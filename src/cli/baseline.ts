import type { Finding } from '../core/analysis';

/** A committed baseline: the Findings a legacy project accepts for now, so only new ones block. */
export interface Baseline {
    version: 1;
    findings: BaselineEntry[];
}

/** Findings of one rule on equal start tags in one file; the count covers identical elements. */
export interface BaselineEntry {
    ruleId: string;
    file: string;
    element: string;
    count: number;
}

/**
 * The element a Finding points at, as its start tag with whitespace collapsed, so the fingerprint survives edits
 * elsewhere in the file and moved lines.
 */
export function elementOf(text: string, finding: Pick<Finding, 'range'>): string {
    const end = text.indexOf('>', finding.range.start);
    const tag = text.slice(finding.range.start, end === -1 ? finding.range.end : Math.min(end + 1, finding.range.start + 500));
    return tag.replace(/\s+/g, ' ').trim();
}

const keyOf = (entry: Omit<BaselineEntry, 'count'>) => JSON.stringify([entry.ruleId, entry.file, entry.element]);

/** The baseline of these Findings, sorted so that it diffs well. */
export function baselineOf(findings: Omit<BaselineEntry, 'count'>[]): Baseline {
    const counts = new Map<string, BaselineEntry>();
    for (const finding of findings) {
        const key = keyOf(finding);
        const entry = counts.get(key) ?? { ruleId: finding.ruleId, file: finding.file, element: finding.element, count: 0 };
        entry.count++;
        counts.set(key, entry);
    }
    return { version: 1, findings: [...counts.values()].sort((a, b) => a.file.localeCompare(b.file) || a.ruleId.localeCompare(b.ruleId) || a.element.localeCompare(b.element)) };
}

/**
 * Which Findings the baseline covers, in order, and how many of its Findings no longer occur. `checked` limits the
 * fixed count to the files that were checked.
 */
export function matchBaseline(baseline: Baseline, findings: Omit<BaselineEntry, 'count'>[], checked: Set<string>): { baselined: boolean[]; fixed: number } {
    const left = new Map(baseline.findings.map(entry => [keyOf(entry), entry.count]));
    const baselined = findings.map(finding => {
        const count = left.get(keyOf(finding)) ?? 0;
        if (count > 0) left.set(keyOf(finding), count - 1);
        return count > 0;
    });
    const fixed = baseline.findings.filter(entry => checked.has(entry.file)).reduce((sum, entry) => sum + (left.get(keyOf(entry)) ?? 0), 0);
    return { baselined, fixed };
}

/** A baseline read from its file; anything else is a configuration error the caller reports. */
export function parseBaseline(text: string): Baseline {
    const value = JSON.parse(text) as Partial<Baseline>;
    if (value.version !== 1 || !Array.isArray(value.findings) || !value.findings.every(entry =>
        typeof entry.ruleId === 'string' && typeof entry.file === 'string' && typeof entry.element === 'string' && Number.isInteger(entry.count) && entry.count > 0)) {
        throw new Error('not an Allyproof baseline (version 1)');
    }
    return value as Baseline;
}
