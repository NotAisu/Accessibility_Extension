// A fake analysis worker speaking the worker protocol; the document text says how it behaves
import { parentPort, threadId } from 'worker_threads';
import { setTimeout } from 'timers/promises';

parentPort.on('message', async document => {
    const [behaviour, arg] = document.text.split(':');
    if (behaviour === 'hang') for (;;);
    if (behaviour === 'crash') throw new Error('engine crashed');
    if (behaviour === 'fail') return parentPort.postMessage({ error: 'engine failed' });
    if (behaviour === 'parse') return parentPort.postMessage({ parseError: 'Parse error at 1:1' });
    if (behaviour === 'slow') await setTimeout(Number(arg));
    // Echoes the text and the worker thread, so tests can see which request ran where
    parentPort.postMessage({ result: { findings: [], needsReview: [{ criterion: document.text, reason: String(threadId) }] } });
});
