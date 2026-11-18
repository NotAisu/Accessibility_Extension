/**
 * Labelled ground truth for the Check and the precision/recall it achieves per WCAG criterion.
 *
 * Two kinds of expectation:
 * - criterion present/absent in the file (ACT test cases have no line numbers)
 * - criterion on a given line; any other line reported for that criterion counts as a false positive
 */
export type Expectation =
    | { criterion: string; present: boolean }
    | { criterion: string; line: number };

export interface GroundTruthCase {
    /** Path relative to the set's expectations.json */
    file: string;
    languageId: string;
    note?: string;
    /** Every criterion is labelled, so a Finding on any criterion not expected there is a false positive. */
    complete?: boolean;
    expect: Expectation[];
}

export interface GroundTruthSet {
    source: string;
    cases: GroundTruthCase[];
}

/** What the Check reported for a case, reduced to what the ground truth can judge. */
export interface ReportedFinding {
    line: number;
    criteria: string[];
}

export interface Tally {
    tp: number;
    fp: number;
    fn: number;
}

export function scoreCase(expectations: Expectation[], findings: ReportedFinding[]): Map<string, Tally> {
    const tallies = new Map<string, Tally>();
    const tally = (criterion: string) => {
        if (!tallies.has(criterion)) tallies.set(criterion, { tp: 0, fp: 0, fn: 0 });
        return tallies.get(criterion)!;
    };
    const linesOf = (criterion: string) =>
        new Set(findings.filter(f => f.criteria.includes(criterion)).map(f => f.line));

    for (const expectation of expectations) {
        const reported = linesOf(expectation.criterion);
        const t = tally(expectation.criterion);
        if ('line' in expectation) {
            if (reported.has(expectation.line)) t.tp++; else t.fn++;
        } else if (expectation.present) {
            if (reported.size > 0) t.tp++; else t.fn++;
        } else if (reported.size > 0) {
            t.fp++;
        }
    }

    const expectedLines = new Map<string, Set<number>>();
    for (const expectation of expectations) {
        if (!('line' in expectation)) continue;
        if (!expectedLines.has(expectation.criterion)) expectedLines.set(expectation.criterion, new Set());
        expectedLines.get(expectation.criterion)!.add(expectation.line);
    }
    for (const [criterion, lines] of expectedLines) {
        for (const line of linesOf(criterion)) {
            if (!lines.has(line)) tally(criterion).fp++;
        }
    }
    return tallies;
}

export function addTallies(into: Map<string, Tally>, from: Map<string, Tally>): void {
    for (const [criterion, t] of from) {
        const sum = into.get(criterion) ?? { tp: 0, fp: 0, fn: 0 };
        into.set(criterion, { tp: sum.tp + t.tp, fp: sum.fp + t.fp, fn: sum.fn + t.fn });
    }
}

/** null when there is nothing to divide, so a criterion without positives is not scored as 0 or 1. */
export function precision(t: Tally): number | null {
    return t.tp + t.fp === 0 ? null : t.tp / (t.tp + t.fp);
}

export function recall(t: Tally): number | null {
    return t.tp + t.fn === 0 ? null : t.tp / (t.tp + t.fn);
}
