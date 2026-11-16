// A fake analysis worker speaking the worker protocol; the document text says how it behaves, `options` echoes the options
import { parentPort, threadId } from 'worker_threads';
import { setTimeout } from 'timers/promises';

parentPort.on('message', async ({ document, options }) => {
    if (document.text === 'options') return parentPort.postMessage({ result: { findings: [], needsReview: [{ criterion: JSON.stringify(options), reason: '' }] } });
    const [behaviour, arg] = document.text.split(':');
    if (behaviour === 'hang') for (;;);
    if (behaviour === 'crash') throw new Error('engine crashed');
    if (behaviour === 'fail') return parentPort.postMessage({ error: 'engine failed' });
    // An engine error whose message quotes the checked code over several lines
    if (behaviour === 'fail-quoting') return parentPort.postMessage({ error: `engine failed on ${'x'.repeat(300)}\n> 1 | const secret = 1;` });
    if (behaviour === 'parse') return parentPort.postMessage({ parseError: 'Parse error at 1:1: Unexpected token "secret"', position: '1:1' });
    if (behaviour === 'slow') await setTimeout(Number(arg));
    // Echoes the text and the worker thread, so tests can see which request ran where
    parentPort.postMessage({ result: { findings: [], needsReview: [{ criterion: document.text, reason: String(threadId) }] } });
});
