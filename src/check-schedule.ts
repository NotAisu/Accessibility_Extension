import type { CheckOutcome } from './analysis-worker';

export interface CheckScheduleOptions {
    /** How long a document must stay unchanged before it is checked. */
    debounceMs?: number;
    /** A warm run over this budget makes the document's Check run on save only. */
    budgetMs?: number;
}

/**
 * When each document's Check runs (#17): a debounce time after the last change, or on save only for a document
 * whose last warm run took over the budget or missed its deadline, so typing stays responsive in large files.
 */
export class CheckSchedule {
    private readonly timers = new Map<string, NodeJS.Timeout>();
    // Documents never checked with unsaved changes
    private readonly saveOnly = new Set<string>();
    private readonly debounceMs: number;
    private readonly budgetMs: number;

    constructor(options: CheckScheduleOptions = {}) {
        this.debounceMs = options.debounceMs ?? 400;
        this.budgetMs = options.budgetMs ?? 150;
    }

    /** Runs `check` once the document has not changed for the debounce time; never for a document checked on save only. */
    changed(key: string, check: () => void): void {
        clearTimeout(this.timers.get(key));
        if (this.saveOnly.has(key)) return;
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            check();
        }, this.debounceMs));
    }

    /** Whether the document may be checked now; one checked on save only is not while it has unsaved changes. */
    mayCheck(key: string, { unsaved }: { unsaved: boolean }): boolean {
        return !unsaved || !this.saveOnly.has(key);
    }

    /** Whether the document is checked on save only; its Check is then a background request with the longer deadline. */
    onSaveOnly(key: string): boolean {
        return this.saveOnly.has(key);
    }

    /** Judges the document by its last warm run; a run that also loaded its engine says nothing about the document. */
    measured(key: string, outcome: CheckOutcome): void {
        if (outcome.status === 'paused' && outcome.deadlineExceeded) this.saveOnly.add(key);
        if (outcome.status !== 'done' || outcome.firstLoad) return;
        if (outcome.durationMs > this.budgetMs) this.saveOnly.add(key);
        else this.saveOnly.delete(key);
    }

    delete(key: string): void {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
        this.saveOnly.delete(key);
    }

    dispose(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }
}
