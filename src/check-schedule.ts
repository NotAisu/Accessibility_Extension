import type { CheckOutcome } from './analysis-worker';

export interface CheckScheduleOptions {
    /** How long a document must stay unchanged before it is checked. */
    debounceMs?: number;
    /** A warm run over this budget makes the document's Check run on save only. */
    budgetMs?: number;
}

/**
 * When each document's Check runs (#17): 400 ms after the last change, or on save only for a document whose
 * last warm run took over 150 ms or missed its deadline, so typing stays responsive in large files.
 */
export class CheckSchedule {
    private readonly timers = new Map<string, NodeJS.Timeout>();
    // Documents never checked with unsaved changes
    private readonly onSaveOnly = new Set<string>();
    private readonly debounceMs: number;
    private readonly budgetMs: number;

    constructor(options: CheckScheduleOptions = {}) {
        this.debounceMs = options.debounceMs ?? 400;
        this.budgetMs = options.budgetMs ?? 150;
    }

    /** Runs `check` once the document has not changed for the debounce time; never for a document checked on save only. */
    changed(key: string, check: () => void): void {
        clearTimeout(this.timers.get(key));
        if (this.onSaveOnly.has(key)) return;
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            check();
        }, this.debounceMs));
    }

    /** Whether the document may be checked now; one checked on save only is not while it has unsaved changes. */
    mayCheck(key: string, { unsaved }: { unsaved: boolean }): boolean {
        return !unsaved || !this.onSaveOnly.has(key);
    }

    /** Judges the document by its last warm run; a run that also loaded its engine says nothing about the document. */
    measured(key: string, outcome: CheckOutcome): void {
        if (outcome.status === 'paused' && outcome.deadlineExceeded) this.onSaveOnly.add(key);
        if (outcome.status !== 'done' || outcome.firstLoad) return;
        if (outcome.durationMs > this.budgetMs) this.onSaveOnly.add(key);
        else this.onSaveOnly.delete(key);
    }

    delete(key: string): void {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
        this.onSaveOnly.delete(key);
    }

    dispose(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }
}
