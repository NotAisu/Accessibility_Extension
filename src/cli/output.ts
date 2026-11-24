import type { AnalysisResult, FixEdit, Severity, TextRange } from '../core/analysis';
import { lineOffsets } from '../core/offsets';

export const SCHEMA_VERSION = 1;

export interface Position {
    /** 1-based, counting the line breaks the editor counts. */
    line: number;
    /** 1-based, in UTF-16 code units like the editor. */
    column: number;
    offset: number;
}

export interface Location {
    start: Position;
    end: Position;
}

export interface FindingOutput {
    ruleId: string;
    criteria: string[];
    severity: Severity;
    layer: 'check';
    message: string;
    helpUrl: string;
    /** Only Proven rules report Findings (#78). */
    proof: 'proven';
    range: Location;
    fix?: { range: Location; newText: string }[];
    baselined: boolean;
}

export interface NeedsReviewOutput {
    criterion: string;
    reason: string;
    /** The Unproven rule that matched; such an entry is a likely failure at `range`. */
    ruleId?: string;
    proof?: 'unproven';
    range?: Location;
}

export interface FileOutput {
    file: string;
    languageId: string;
    /** `failed`: the file could not be checked (parse error, engine crash or deadline overrun). */
    status: 'checked' | 'failed';
    error?: string;
    findings: FindingOutput[];
    needsReview: NeedsReviewOutput[];
}

export interface CheckOutput {
    schemaVersion: typeof SCHEMA_VERSION;
    files: FileOutput[];
    summary: {
        files: number;
        failedFiles: number;
        findings: number;
        blocking: number;
        baselined: number;
        /** Baselined Findings that no longer occur in the checked files. */
        fixedSinceBaseline: number;
        needsReview: number;
        /** Findings per file, rule and criterion; set when a folder is checked through the MCP server. */
        byFile?: Record<string, number>;
        byRule?: Record<string, number>;
        byCriterion?: Record<string, number>;
    };
    /** Set when a folder is checked through the MCP server: `files` holds only the first files, `summary` covers all. */
    truncated?: boolean;
    /** How to narrow a truncated result down. */
    hint?: string;
}

/** A checked file's results with editor positions; `baselined` says which Findings the baseline covers. */
export function fileOutput(file: string, languageId: string, text: string, result: AnalysisResult, baselined: boolean[]): FileOutput {
    const starts = lineOffsets(text);
    const position = (offset: number): Position => {
        let line = starts.length;
        while (starts[line - 1] > offset) line--;
        return { line, column: offset - starts[line - 1] + 1, offset };
    };
    const location = (range: TextRange): Location => ({ start: position(range.start), end: position(range.end) });
    return {
        file,
        languageId,
        status: 'checked',
        findings: result.findings.map((finding, i) => ({
            ruleId: finding.ruleId,
            criteria: finding.criteria,
            severity: finding.severity,
            layer: 'check',
            message: finding.message,
            helpUrl: finding.helpUrl,
            proof: 'proven',
            range: location(finding.range),
            ...finding.fix ? { fix: finding.fix.map((edit: FixEdit) => ({ range: location(edit.range), newText: edit.newText })) } : {},
            baselined: baselined[i]
        })),
        needsReview: result.needsReview.map(entry => ({
            criterion: entry.criterion,
            reason: entry.reason,
            ...entry.ruleId ? { ruleId: entry.ruleId, proof: 'unproven' as const } : {},
            ...entry.range ? { range: location(entry.range) } : {}
        }))
    };
}

export interface FormatOptions {
    /** Enable ANSI color and box-drawing polish for interactive terminals (false for piped/CI/NO_COLOR). */
    color?: boolean;
}

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    underline: '\x1b[4m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
} as const;

export function supportsColor(stream: { isTTY?: boolean } = process.stdout, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
    return Boolean(stream.isTTY);
}

export function helpBanner(version: string, options: FormatOptions = {}): string {
    const c = Boolean(options.color);
    const paint = (code: string, value: string) => (c ? `${code}${value}${ANSI.reset}` : value);
    const lines = [
        `  ${paint(ANSI.dim, '╭─────────╮')}  ${paint(ANSI.bold + ANSI.cyan, 'allyproof')} ${paint(ANSI.dim, `v${version}`)}`,
        `  ${paint(ANSI.dim, '│')} ${paint(ANSI.green, '▓▓▓▓▓▓▓')} ${paint(ANSI.dim, '│')}  Local WCAG 2.2 AA accessibility checker`,
        `  ${paint(ANSI.dim, '│')} ${paint(ANSI.green, '▓  ✔  ▓')} ${paint(ANSI.dim, '│')}  ${paint(ANSI.dim, 'HTML · React · Vue · Svelte · Angular · Astro')}`,
        `  ${paint(ANSI.dim, '╰─────────╯')}  ${paint(ANSI.dim, 'Offline · Zero telemetry · Zero workspace code execution')}`,
        ''
    ];
    return lines.join('\n');
}

export function text(output: CheckOutput, options: FormatOptions = {}): string {
    const c = Boolean(options.color);
    const paint = (code: string, value: string) => (c ? `${code}${value}${ANSI.reset}` : value);
    const lines: string[] = [];
    if (c) lines.push(paint(ANSI.dim, '╭─ ') + paint(ANSI.bold + ANSI.cyan, 'allyproof') + paint(ANSI.dim, ' ───────────────────────────────────────'));
    for (const file of output.files) {
        if (file.status === 'failed') {
            lines.push(paint(ANSI.bold + ANSI.underline, file.file), `  ${paint(ANSI.red, 'could not be checked:')} ${file.error}`, '');
            continue;
        }
        const findings = file.findings.filter(f => !f.baselined);
        const likely = file.needsReview.filter(e => e.range);
        if (findings.length === 0 && likely.length === 0) continue;
        lines.push(paint(ANSI.bold + ANSI.underline, file.file));
        for (const f of findings) {
            const loc = paint(ANSI.dim, `${f.range.start.line}:${f.range.start.column}`);
            const sevColor = f.severity === 'error' ? ANSI.red : f.severity === 'warning' ? ANSI.yellow : ANSI.cyan;
            const sev = paint(sevColor, f.severity.padEnd(11));
            const meta = paint(ANSI.dim, `WCAG ${f.criteria[0]}  ${f.ruleId}`);
            lines.push(`  ${loc}  ${sev} ${f.message}  ${meta}`, `      ${paint(ANSI.dim, f.helpUrl)}`);
        }
        for (const e of likely) {
            const loc = paint(ANSI.dim, `${e.range!.start.line}:${e.range!.start.column}`);
            lines.push(`  ${loc}  ${paint(ANSI.yellow, 'needs review')} WCAG ${e.criterion}: ${e.reason}`);
        }
        lines.push('');
    }
    const s = output.summary;
    const parts = [
        `${s.files} ${s.files === 1 ? 'file' : 'files'} checked`,
        `${s.blocking} blocking ${s.blocking === 1 ? 'Finding' : 'Findings'}`,
        ...s.findings > s.blocking ? [`${s.findings - s.blocking} not blocking`] : [],
        ...s.baselined || s.fixedSinceBaseline ? [`${s.baselined} baselined (${s.fixedSinceBaseline} fixed since the baseline)`] : [],
        `${s.needsReview} Needs Review`,
        ...s.failedFiles ? [`${s.failedFiles} could not be checked`] : []
    ];
    if (c) {
        const ok = s.blocking === 0 && s.failedFiles === 0;
        const badge = ok ? paint(ANSI.bold + ANSI.green, '✔') : paint(ANSI.bold + ANSI.red, '✖');
        lines.push(paint(ANSI.dim, '╰────────────────────────────────────────────────────'));
        lines.push(`${badge} ${parts.join(', ')}`);
    } else {
        lines.push(parts.join(', '));
    }
    return lines.join('\n') + '\n';
}

const SARIF_LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', information: 'note' };

/** SARIF 2.1.0 for code scanning: Needs Review as notes, baselined Findings suppressed, so neither fails. */
export function sarif(output: CheckOutput, version: string): unknown {
    const region = (range: Location) => ({ startLine: range.start.line, startColumn: range.start.column, endLine: range.end.line, endColumn: range.end.column });
    const at = (file: string, range: Location) => [{ physicalLocation: { artifactLocation: { uri: file }, region: region(range) } }];
    const rules = new Map<string, { id: string; helpUri?: string; shortDescription: { text: string } }>();
    const results = output.files.flatMap(file => [
        ...file.findings.map(f => {
            if (!rules.has(f.ruleId)) rules.set(f.ruleId, { id: f.ruleId, helpUri: f.helpUrl, shortDescription: { text: f.message } });
            return {
                ruleId: f.ruleId,
                level: SARIF_LEVEL[f.severity],
                message: { text: `${f.message} (WCAG ${f.criteria.join(', ')})` },
                locations: at(file.file, f.range),
                ...f.baselined ? { suppressions: [{ kind: 'external', justification: 'In the Allyproof baseline' }] } : {}
            };
        }),
        ...file.needsReview.flatMap(e => e.range ? [{
            ruleId: e.ruleId ?? `needs-review/${e.criterion}`,
            level: 'note',
            message: { text: `Needs Review, WCAG ${e.criterion}: ${e.reason}` },
            locations: at(file.file, e.range)
        }] : []),
        ...file.status === 'failed' ? [{
            ruleId: 'allyproof/not-checked',
            level: 'error',
            message: { text: `Could not be checked: ${file.error}` },
            locations: [{ physicalLocation: { artifactLocation: { uri: file.file } } }]
        }] : []
    ]);
    for (const result of results) if (!rules.has(result.ruleId)) rules.set(result.ruleId, { id: result.ruleId, shortDescription: { text: result.message.text } });
    return {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [{
            tool: { driver: { name: 'Allyproof', version, informationUri: 'https://github.com/NotAisu/Accessibility_Extension', rules: [...rules.values()] } },
            results
        }]
    };
}
