import { parentPort } from 'worker_threads';
import { analyse, AnalysisDocument, AnalysisOptions, AnalysisResult, ParseError } from './analysis';

export interface WorkerRequest {
    document: AnalysisDocument;
    options: AnalysisOptions;
}

export type WorkerReply = { result: AnalysisResult } | { error: string } | { parseError: string };

// The worker entry (ADR 0003): checks one document at a time off the extension host thread
const port = parentPort!;
port.on('message', ({ document, options }: WorkerRequest) => {
    analyse(document, options).then(
        result => port.postMessage({ result } satisfies WorkerReply),
        (error: unknown) => port.postMessage((error instanceof ParseError
            ? { parseError: error.message }
            : { error: error instanceof Error ? error.message : String(error) }) satisfies WorkerReply)
    );
});
