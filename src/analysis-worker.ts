import { Worker } from 'worker_threads';
import type { AnalysisDocument, AnalysisOptions, AnalysisResult } from './core/analysis';
import { logText } from './core/log-text';
import type { WorkerReply, WorkerRequest } from './core/worker';

export type CheckOutcome =
    /** `durationMs`: how long the run took in the worker; `firstLoad`: the run also loaded its engine. */
    | { status: 'done'; result: AnalysisResult; durationMs: number; firstLoad: boolean }
    /** A newer version of the document was requested before this one answered, or the worker was disposed. */
    | { status: 'dropped' }
    /** The Check could not run; the last Findings stay. */
    | { status: 'paused'; reason: string; deadlineExceeded: boolean };

/** The language ids whose engine ran in this session, and those the circuit breaker paused. */
export interface EngineUsage {
    used: string[];
    paused: string[];
}

/** Where the worker reports what went wrong; a `LogOutputChannel` in the extension. Never given file contents: error messages go capped to their first line. */
export interface WorkerLog {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface AnalysisWorkerOptions {
    deadlineMs?: number;
    /** The deadline of an engine's first run in a worker, which also loads the engine. */
    firstLoadMs?: number;
    /** The deadline of a background request, whose result no one waits for while typing. */
    backgroundDeadlineMs?: number;
    now?: () => number;
    log?: WorkerLog;
}

// Circuit breaker: an engine failing this often is paused for the session
const MAX_FAILURES = 3;
const FAILURE_WINDOW_MS = 3 * 60_000;
const FAILURE_WINDOW = `${FAILURE_WINDOW_MS / 60_000} minutes`;
// A runaway engine ends its own thread instead of growing the extension host's memory
const MAX_HEAP_MB = 512;

export interface CheckRequestOptions {
    /**
     * A request no one is typing in, such as the Check of a file checked on save only or the workspace Check; it runs
     * in the background worker with the background deadline.
     */
    background?: boolean;
}

interface Request {
    key: string;
    document: AnalysisDocument;
    options: AnalysisOptions;
    resolve: (outcome: CheckOutcome) => void;
}

/**
 * Runs the Check in two long-lived worker threads (ADR 0003), each one request at a time: the typing worker for the
 * Checks someone waits for, the background worker for background requests. A large file's background Check then never
 * holds up the file being typed in, and its deadline overrun never unloads the typing worker's engines. Both share one
 * circuit breaker.
 */
export class AnalysisWorker {
    private readonly typing: CheckWorker;
    private readonly background: CheckWorker;
    private readonly breaker: CircuitBreaker;

    constructor(script: string, options: AnalysisWorkerOptions = {}) {
        const now = options.now ?? Date.now;
        const { log } = options;
        this.breaker = new CircuitBreaker(now, log);
        const shared = { script, firstLoadMs: options.firstLoadMs ?? 15_000, breaker: this.breaker, now, log };
        this.typing = new CheckWorker({ ...shared, name: 'typing worker', deadlineMs: options.deadlineMs ?? 1000 });
        // Long enough for a large file's Check (a few seconds), short enough that a hung engine is still ended
        this.background = new CheckWorker({ ...shared, name: 'background worker', deadlineMs: options.backgroundDeadlineMs ?? 10_000 });
    }

    /** The engines run in this session and those the circuit breaker paused, for an issue report. */
    engines(): EngineUsage {
        return this.breaker.engines();
    }

    check(key: string, document: AnalysisDocument, options: AnalysisOptions = {}, { background = false }: CheckRequestOptions = {}): Promise<CheckOutcome> {
        return new Promise(resolve => {
            // The newest request for a document wins, in whichever worker the older one waits. One running in the other
            // worker could answer after this one, so it is dropped too; one running in the same worker answers first
            const [target, other] = background ? [this.background, this.typing] : [this.typing, this.background];
            target.drop(key);
            other.drop(key, { running: true });
            target.add({ key, document, options, resolve });
        });
    }

    /** Ends both workers; every request not yet answered is dropped. */
    dispose(): void {
        this.typing.dispose();
        this.background.dispose();
    }
}

/** Pauses an engine for the session once it failed too often, in either worker; engines are per language (ADR 0002). */
class CircuitBreaker {
    // Recent failure times per engine
    private readonly failures = new Map<string, number[]>();
    // Languages checked this session, for an issue report
    private readonly checkedLanguages = new Set<string>();

    constructor(private readonly now: () => number, private readonly log: WorkerLog | undefined) {}

    engines(): EngineUsage {
        return {
            used: [...this.checkedLanguages].sort(),
            paused: [...this.failures].filter(([, times]) => times.length >= MAX_FAILURES).map(([engine]) => engine).sort()
        };
    }

    /** Why the engine may not run, or undefined when it may. */
    pausedReason(engine: string): string | undefined {
        if ((this.failures.get(engine)?.length ?? 0) < MAX_FAILURES) return undefined;
        return `The ${engine} engine failed ${MAX_FAILURES} times within ${FAILURE_WINDOW} and is paused for this session`;
    }

    /** Records that the engine ran this session, for an issue report. */
    recordUse(engine: string): void {
        this.checkedLanguages.add(engine);
    }

    recordFailure(engine: string): void {
        const now = this.now();
        const recent = [...(this.failures.get(engine) ?? []).filter(time => now - time <= FAILURE_WINDOW_MS), now];
        this.failures.set(engine, recent);
        if (recent.length === MAX_FAILURES) this.log?.error(`${engine} engine paused for this session after ${MAX_FAILURES} failures within ${FAILURE_WINDOW}`);
    }
}

interface CheckWorkerOptions {
    script: string;
    /** How the worker names itself in the log and in a paused Check's reason: "typing worker" or "background worker". */
    name: string;
    deadlineMs: number;
    firstLoadMs: number;
    breaker: CircuitBreaker;
    now: () => number;
    log: WorkerLog | undefined;
}

/** The typing or the background worker: one worker thread and its queue; the thread spawns on the first request. */
class CheckWorker {
    private worker: Worker | undefined;
    private running: { request: Request; deadline: NodeJS.Timeout; started: number; firstLoad: boolean } | undefined;
    // At most one pending request per document: the newest wins
    private readonly pending = new Map<string, Request>();
    // Engines that answered in the current worker; the first run of any other also loads it
    private loaded = new Set<string>();

    constructor(private readonly options: CheckWorkerOptions) {}

    /** Drops the pending request for the document and, with `running`, the running one, whose result then goes nowhere. */
    drop(key: string, { running = false } = {}): void {
        this.pending.get(key)?.resolve({ status: 'dropped' });
        this.pending.delete(key);
        if (running && this.running?.request.key === key) {
            this.running.request.resolve({ status: 'dropped' });
            this.running.request = { ...this.running.request, resolve: () => undefined };
        }
    }

    add(request: Request): void {
        this.pending.set(request.key, request);
        this.next();
    }

    dispose(): void {
        if (this.running) {
            clearTimeout(this.running.deadline);
            this.running.request.resolve({ status: 'dropped' });
        }
        this.running = undefined;
        this.pending.forEach(request => request.resolve({ status: 'dropped' }));
        this.pending.clear();
        void this.worker?.terminate();
        this.worker = undefined;
    }

    private next(): void {
        if (this.running) return;
        const [request] = this.pending.values();
        if (!request) return;
        this.pending.delete(request.key);
        const { breaker, name, log, now } = this.options;
        const engine = request.document.languageId;
        const paused = breaker.pausedReason(engine);
        if (paused !== undefined) {
            request.resolve({ status: 'paused', reason: paused, deadlineExceeded: false });
            return this.next();
        }
        breaker.recordUse(engine);
        this.worker ??= this.spawn();
        const firstLoad = !this.loaded.has(engine);
        const deadlineMs = firstLoad ? this.options.firstLoadMs : this.options.deadlineMs;
        const deadline = setTimeout(() => {
            // A synchronous engine cannot be interrupted, only its thread can be ended
            void this.worker?.terminate();
            this.worker = undefined;
            log?.warn(`${engine} Check took longer than ${deadlineMs} ms; the ${name} is restarted`);
            this.finish({ status: 'paused', reason: `The Check took longer than ${deadlineMs} ms`, deadlineExceeded: true }, false);
        }, deadlineMs);
        this.running = { request, deadline, started: now(), firstLoad };
        this.worker.postMessage({ document: request.document, options: request.options } satisfies WorkerRequest);
    }

    // A parse error is the user's code and a deadline overrun a large file, not the engine failing, so neither trips
    // the circuit breaker; crashes and engine errors do
    private finish(outcome: CheckOutcome, failure = outcome.status === 'paused'): void {
        if (!this.running) return;
        clearTimeout(this.running.deadline);
        if (failure) this.options.breaker.recordFailure(this.running.request.document.languageId);
        this.running.request.resolve(outcome);
        this.running = undefined;
        this.next();
    }

    private spawn(): Worker {
        const { script, name, log, now } = this.options;
        const worker = new Worker(script, { resourceLimits: { maxOldGenerationSizeMb: MAX_HEAP_MB } });
        this.loaded = new Set();
        log?.info(`The ${name} started`);
        worker.on('message', (reply: WorkerReply) => {
            if (worker !== this.worker) return;
            if (!this.running) return;
            const { request, started, firstLoad } = this.running;
            this.loaded.add(request.document.languageId);
            if ('result' in reply) this.finish({ status: 'done', result: reply.result, durationMs: now() - started, firstLoad });
            else if ('parseError' in reply) {
                // The user's code, so the log, where the paused state links, says where only, never what the parser quotes
                log?.warn(`${request.document.languageId} Check paused: parse error at ${logText(reply.position)}`);
                this.finish({ status: 'paused', reason: reply.parseError, deadlineExceeded: false }, false);
            } else {
                log?.error(`${request.document.languageId} engine failed: ${logText(reply.error)}`);
                this.finish({ status: 'paused', reason: reply.error, deadlineExceeded: false });
            }
        });
        // An ended worker is replaced on the next request; one ended on purpose is no longer this.worker
        const stopped = (reason: string) => {
            if (worker !== this.worker) return;
            this.worker = undefined;
            log?.error(logText(this.running ? `${this.running.request.document.languageId} engine: ${reason}` : reason));
            this.finish({ status: 'paused', reason, deadlineExceeded: false });
        };
        worker.on('error', (error: Error) => stopped(`The ${name} crashed: ${error.message}`));
        worker.on('exit', code => stopped(`The ${name} stopped (exit code ${code})`));
        // An idle worker must not keep the process alive; a running request's deadline timer does.
        // Only after the listeners: adding a 'message' listener refs the worker again.
        worker.unref();
        return worker;
    }
}
