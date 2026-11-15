import type { CheckOutcome } from '../analysis-worker';
import type { AnalysisDocument, Finding, NeedsReview } from '../core/analysis';

/** What an agent passes to `a11y_check`: a file, proposed code, or proposed code for a file. */
export interface CheckToolInput {
    filePath?: string;
    code?: string;
    languageId?: string;
}

/** The JSON `a11y_check` answers with. */
export interface CheckToolOutput {
    languageId: string;
    findings: (Pick<Finding, 'criteria' | 'ruleId' | 'severity' | 'message' | 'explanation' | 'helpUrl'> & { line: number })[];
    needsReview: NeedsReview[];
}

export interface CheckToolPorts {
    /** Language ids the Check supports. */
    languages: string[];
    /** The file's current text, unsaved changes included, and its language id. */
    read(filePath: string): Promise<AnalysisDocument>;
    check(document: AnalysisDocument): Promise<CheckOutcome>;
}

/** Runs the Check for an agent and answers with JSON the agent can act on. */
export async function runCheckTool(input: CheckToolInput, ports: CheckToolPorts): Promise<string> {
    if (input.filePath === undefined && input.code === undefined) {
        throw new Error('Pass filePath to check a file, code (with languageId) to check proposed code, or both to check proposed code for that file.');
    }
    const file = input.filePath === undefined ? undefined : await ports.read(input.filePath);
    const document = { languageId: input.languageId ?? file?.languageId ?? '', text: input.code ?? file?.text ?? '' };
    if (!ports.languages.includes(document.languageId)) {
        throw new Error(`The Check does not support the language "${document.languageId}". Supported language ids: ${ports.languages.join(', ')}.`);
    }
    const outcome = await ports.check(document);
    if (outcome.status === 'paused') throw new Error(`The Check is paused: ${outcome.reason}. Its result is unknown, not empty.`);
    if (outcome.status === 'dropped') throw new Error('The Check was superseded by a newer request. Call a11y_check again.');
    const lineStarts = [...document.text.matchAll(/\n/g)].map(m => (m.index ?? 0) + 1);
    const lineOf = (offset: number) => 1 + lineStarts.filter(start => start <= offset).length;
    const output: CheckToolOutput = {
        languageId: document.languageId,
        findings: outcome.result.findings.map(f => ({
            line: lineOf(f.range.start),
            criteria: f.criteria,
            ruleId: f.ruleId,
            severity: f.severity,
            message: f.message,
            explanation: f.explanation,
            helpUrl: f.helpUrl
        })),
        needsReview: outcome.result.needsReview
    };
    return JSON.stringify(output);
}
