import { Worker } from 'worker_threads';
import type { AnalysisDocument, AnalysisOptions, AnalysisResult } from './core/analysis';
import type { WorkerReply, WorkerRequest } from './core/worker';

export type CheckOutcome =
    /** `durationMs`: how long the run took in the worker; `firstLoad`: the run also loaded its engine. */
    | { status: 'done'; result: AnalysisResult; durationMs: number; firstLoad: boolean }
    /** A newer version of the document was requested before this one ran. */
    | { status: 'dropped' }
    /** The Check could not run; the last Findings stay. */
    | { status: 'paused'; reason: string; deadlineExceeded: boolean };

/** Where the worker reports what went wrong; a `LogOutputChannel` in the extension. Never given file contents. */
export interface WorkerLog {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface AnalysisWorkerOptions {
    deadlineMs?: number;
    /** The deadline of an engine's first run in a worker, which also loads the engine. */
    firstLoadMs?: number;
    now?: () => number;
    log?: WorkerLog;
}

// Circuit breaker: an engine failing this often is paused for the session
const MAX_FAILURES = 3;
const FAILURE_WINDOW_MS = 3 * 60_000;
// A runaway engine ends its own thread instead of growing the extension host's memory
const MAX_HEAP_MB = 512;

interface Request {
    key: string;
    document: AnalysisDocument;
    options: AnalysisOptions;
    resolve: (outcome: CheckOutcome) => void;
}

/** Runs the Check in one long-lived worker thread (ADR 0003), one request at a time. */
export class AnalysisWorker {
    private worker: Worker | undefined;
    private running: { request: Request; deadline: NodeJS.Timeout; started: number; firstLoad: boolean } | undefined;
    // At most one pending request per document: the newest wins
    private readonly pending = new Map<string, Request>();

    // Recent failure times per engine; engines are per language (ADR 0002)
    private readonly failures = new Map<string, number[]>();
    // Engines that answered in the current worker; the first run of any other also loads it
    private loaded = new Set<string>();
    private readonly used = new Set<string>();
    private readonly deadlineMs: number;
    private readonly firstLoadMs: number;
    private readonly now: () => number;
    private readonly log: WorkerLog | undefined;

    constructor(private readonly script: string, options: AnalysisWorkerOptions = {}) {
        this.deadlineMs = options.deadlineMs ?? 1000;
        this.firstLoadMs = options.firstLoadMs ?? 15_000;
        this.now = options.now ?? Date.now;
        this.log = options.log;
    }

    /** The engines run in this session and those the circuit breaker paused, for an issue report. */
    engines(): { used: string[]; paused: string[] } {
        return {
            used: [...this.used].sort(),
            paused: [...this.failures].filter(([, times]) => times.length >= MAX_FAILURES).map(([engine]) => engine).sort()
        };
    }

    check(key: string, document: AnalysisDocument, options: AnalysisOptions = {}): Promise<CheckOutcome> {
        return new Promise(resolve => {
            this.pending.get(key)?.resolve({ status: 'dropped' });
            this.pending.delete(key);
            this.pending.set(key, { key, document, options, resolve });
            this.next();
        });
    }

    dispose(): void {
        if (this.running) clearTimeout(this.running.deadline);
        this.running = undefined;
        this.pending.clear();
        void this.worker?.terminate();
        this.worker = undefined;
    }

    private next(): void {
        if (this.running) return;
        const [request] = this.pending.values();
        if (!request) return;
        this.pending.delete(request.key);
        const engine = request.document.languageId;
        if ((this.failures.get(engine)?.length ?? 0) >= MAX_FAILURES) {
            const reason = `The ${engine} engine failed ${MAX_FAILURES} times within 3 minutes and is paused for this session`;
            request.resolve({ status: 'paused', reason, deadlineExceeded: false });
            return this.next();
        }
        this.worker ??= this.spawn();
        this.used.add(engine);
        const firstLoad = !this.loaded.has(engine);
        const deadlineMs = firstLoad ? this.firstLoadMs : this.deadlineMs;
        const deadline = setTimeout(() => {
            // A synchronous engine cannot be interrupted, only its thread can be ended
            void this.worker?.terminate();
            this.worker = undefined;
            this.log?.warn(`${engine} Check took longer than ${deadlineMs} ms; the analysis worker is restarted`);
            this.finish({ status: 'paused', reason: `The Check took longer than ${deadlineMs} ms`, deadlineExceeded: true });
        }, deadlineMs);
        this.running = { request, deadline, started: this.now(), firstLoad };
        this.worker.postMessage({ document: request.document, options: request.options } satisfies WorkerRequest);
    }

    // A parse error is the user's code, not the engine failing, so it never trips the circuit breaker
    private finish(outcome: CheckOutcome, failure = outcome.status === 'paused'): void {
        if (!this.running) return;
        clearTimeout(this.running.deadline);
        if (failure) this.recordFailure(this.running.request.document.languageId);
        this.running.request.resolve(outcome);
        this.running = undefined;
        this.next();
    }

    private recordFailure(engine: string): void {
        const now = this.now();
        const recent = [...(this.failures.get(engine) ?? []).filter(time => now - time <= FAILURE_WINDOW_MS), now];
        this.failures.set(engine, recent);
        if (recent.length === MAX_FAILURES) this.log?.error(`${engine} engine paused for this session after ${MAX_FAILURES} failures within 3 minutes`);
    }

    private spawn(): Worker {
        const worker = new Worker(this.script, { resourceLimits: { maxOldGenerationSizeMb: MAX_HEAP_MB } });
        this.loaded = new Set();
        this.log?.info('Analysis worker started');
        worker.on('message', (reply: WorkerReply) => {
            if (worker !== this.worker) return;
            if (!this.running) return;
            const { request, started, firstLoad } = this.running;
            this.loaded.add(request.document.languageId);
            if ('result' in reply) this.finish({ status: 'done', result: reply.result, durationMs: this.now() - started, firstLoad });
            else if ('parseError' in reply) this.finish({ status: 'paused', reason: reply.parseError, deadlineExceeded: false }, false);
            else {
                this.log?.error(`${request.document.languageId} engine failed: ${reply.error}`);
                this.finish({ status: 'paused', reason: reply.error, deadlineExceeded: false });
            }
        });
        // An ended worker is replaced on the next request; one ended on purpose is no longer this.worker
        const stopped = (reason: string) => {
            if (worker !== this.worker) return;
            this.worker = undefined;
            this.log?.error(this.running ? `${this.running.request.document.languageId} engine: ${reason}` : reason);
            this.finish({ status: 'paused', reason, deadlineExceeded: false });
        };
        worker.on('error', (error: Error) => stopped(`The analysis worker crashed: ${error.message}`));
        worker.on('exit', code => stopped(`The analysis worker stopped (exit code ${code})`));
        // An idle worker must not keep the process alive; a running request's deadline timer does.
        // Only after the listeners: adding a 'message' listener refs the worker again.
        worker.unref();
        return worker;
    }
}
