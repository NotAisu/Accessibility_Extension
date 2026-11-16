/**
 * Scores Skill Variants per model through the AI Review seam and picks the Variant that ships.
 * Runs only locally (npm run bench), never in CI.
 */
import type { Finding } from '../../src/core/analysis';
import { ModelError, ModelPort, ModelRequest, ReviewCache, review } from '../../src/review/ai-review';
import { Tally, precision, recall } from '../ground-truth/ground-truth';

export interface BenchCase {
    id: string;
    /** Where the case comes from, for the report. */
    source: string;
    /** Made by wrapping a labelled case into a component, not labelled as it is. */
    synthetic: boolean;
    languageId: string;
    text: string;
    /** The criteria the case is labelled with; a Finding with any of them counts, one with none is a false positive. */
    criteria: string[];
    /** A failing case expects a Finding with one of the criteria, a passing case none. */
    failing: boolean;
}

export interface Variant {
    name: string;
    text: string;
}

export interface BenchResult extends Tally {
    variant: string;
    model: string;
    recall: number | null;
    precision: number | null;
    /** Input and output tokens of every request, counted with the model's tokenizer. */
    tokens: number;
    /** Cases whose review failed; they count as reviews without Findings. */
    errors: number;
}

export interface BenchOptions {
    /** Per model request. */
    deadlineMs?: number;
    log?: (line: string) => void;
}

export async function runBenchmark(cases: BenchCase[], variants: Variant[], models: ModelPort[], options: BenchOptions = {}): Promise<BenchResult[]> {
    const results: BenchResult[] = [];
    for (const model of models) {
        for (const variant of variants) {
            const usage = { tokens: 0 };
            const counted = countingTokens(model, usage);
            const result: BenchResult = { variant: variant.name, model: model.id, tp: 0, fp: 0, fn: 0, recall: null, precision: null, tokens: 0, errors: 0 };
            for (const [i, testCase] of cases.entries()) {
                let findings: Finding[] = [];
                try {
                    ({ findings } = await review(
                        // Without Check Findings, so the score is what the model finds and not what the Check found already
                        { document: { languageId: testCase.languageId, text: testCase.text }, checkFindings: [] },
                        { model: counted, skill: variant, cache: noCache, deadlineMs: options.deadlineMs }
                    ));
                } catch (error) {
                    if (error instanceof ModelError && error.code === 'Cancelled') throw error;
                    result.errors++;
                    options.log?.(`${variant.name} on ${model.id}, ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
                }
                const hit = findings.some(f => f.criteria.some(c => testCase.criteria.includes(c)));
                if (testCase.failing) {
                    if (hit) result.tp++; else result.fn++;
                    // A Finding with none of the labelled criteria is wrong on a failing case too
                    if (findings.some(f => !f.criteria.some(c => testCase.criteria.includes(c)))) result.fp++;
                } else if (hit) {
                    result.fp++;
                }
                options.log?.(`${variant.name} on ${model.id}: ${i + 1}/${cases.length}`);
            }
            result.recall = recall(result);
            result.precision = precision(result);
            result.tokens = usage.tokens;
            results.push(result);
        }
    }
    return results;
}

// Every case is reviewed afresh
const noCache: ReviewCache = { get: () => undefined, set: () => undefined };

function countingTokens(model: ModelPort, usage: { tokens: number }): ModelPort {
    return {
        id: model.id,
        name: model.name,
        maxInputTokens: model.maxInputTokens,
        countTokens: text => model.countTokens(text),
        async request(request: ModelRequest, signal: AbortSignal) {
            const output = await model.request(request, signal);
            usage.tokens += await model.countTokens(request.messages.join('\n')) + await model.countTokens(JSON.stringify(output ?? null));
            return output;
        }
    };
}

/** The lowest precision a Variant may ship with. */
export const MIN_PRECISION = 0.8;

/** A Variant's score summed over all models. */
export type VariantScore = Omit<BenchResult, 'model'>;

export function totals(results: BenchResult[]): VariantScore[] {
    const byVariant = new Map<string, VariantScore>();
    for (const r of results) {
        const sum = byVariant.get(r.variant) ?? { variant: r.variant, tp: 0, fp: 0, fn: 0, recall: null, precision: null, tokens: 0, errors: 0 };
        byVariant.set(r.variant, { ...sum, tp: sum.tp + r.tp, fp: sum.fp + r.fp, fn: sum.fn + r.fn, tokens: sum.tokens + r.tokens, errors: sum.errors + r.errors });
    }
    return [...byVariant.values()].map(s => ({ ...s, recall: recall(s), precision: precision(s) }));
}

/** Recall first, among the Variants with a precision of at least 0.8; fewer tokens break a tie. */
export function chooseWinner(results: BenchResult[]): VariantScore | undefined {
    return totals(results)
        .filter(s => s.precision !== null && s.precision >= MIN_PRECISION)
        .sort((a, b) => (b.recall ?? 0) - (a.recall ?? 0) || a.tokens - b.tokens)[0];
}
