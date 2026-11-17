import type { Linter } from 'eslint/universal';
import { lineOffsets } from './offsets';

/**
 * Lints `text` with the bundled config `config(skip)`. A rule that throws on unusual code would cost every other
 * rule's Findings, so the document is linted again without it.
 */
export function lintSkippingCrashedRules(linter: Linter, text: string, filename: string, config: (skip: Set<string>) => Linter.Config[]): Linter.LintMessage[] {
    const skip = new Set<string>();
    for (;;) {
        try {
            return linter.verify(text, config(skip), filename);
        } catch (error) {
            const ruleId = (error as { ruleId?: unknown }).ruleId;
            if (typeof ruleId !== 'string' || skip.has(ruleId)) throw error;
            skip.add(ruleId);
        }
    }
}

/** The text offset of an ESLint 1-based line and column, capped at the end of `text`. */
export function eslintOffsets(text: string): (line: number, column: number) => number {
    const offsets = lineOffsets(text);
    return (line, column) => Math.min(offsets[line - 1] + column - 1, text.length);
}
