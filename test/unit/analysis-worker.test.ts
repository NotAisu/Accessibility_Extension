import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { AnalysisWorker, CheckOutcome } from '../../src/analysis-worker';

const FAKE_ENGINE = path.join(__dirname, 'fixtures', 'fake-engine.mjs');

const html = (text: string) => ({ languageId: 'html', text });

// The fake engine echoes the checked text and the worker's thread id as a Needs Review entry
function echoed(outcome: CheckOutcome): { text: string; thread: string } {
    assert.strictEqual(outcome.status, 'done');
    const [entry] = outcome.result.needsReview;
    return { text: entry.criterion, thread: entry.reason };
}

describe('AnalysisWorker', () => {
    let worker: AnalysisWorker;
    afterEach(() => worker.dispose());

    it('returns the result of the analysis run in the worker', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);

        const outcome = await worker.check('a.html', html('ok'));

        assert.strictEqual(echoed(outcome).text, 'ok');
    });

    it('drops a pending request for a document when a newer version arrives', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);
        const busy = worker.check('b.html', html('slow:100'));

        const older = worker.check('a.html', html('v1'));
        const newer = worker.check('a.html', html('v2'));

        assert.deepStrictEqual(await older, { status: 'dropped' });
        assert.strictEqual(echoed(await newer).text, 'v2');
        assert.strictEqual(echoed(await busy).text, 'slow:100');
    });

    it('stops a request at its deadline and runs the next one on a fresh worker', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200 });
        const before = echoed(await worker.check('a.html', html('ok')));

        const hung = await worker.check('a.html', html('hang'));
        const after = echoed(await worker.check('a.html', html('ok')));

        assert.deepStrictEqual(hung, { status: 'paused', reason: 'The Check took longer than 200 ms', deadlineExceeded: true });
        assert.notStrictEqual(after.thread, before.thread);
    });

    it('pauses a request whose worker crashed and runs the next one on a fresh worker', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);

        const crashed = await worker.check('a.html', html('crash'));
        const after = await worker.check('a.html', html('ok'));

        assert.deepStrictEqual(crashed, { status: 'paused', reason: 'The analysis worker crashed: engine crashed', deadlineExceeded: false });
        assert.strictEqual(echoed(after).text, 'ok');
    });

    it('pauses a request whose engine failed, with the reason', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);

        const failed = await worker.check('a.html', html('fail'));

        assert.deepStrictEqual(failed, { status: 'paused', reason: 'engine failed', deadlineExceeded: false });
    });

    it('pauses an engine for the session after 3 failures within 3 minutes', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200 });
        await worker.check('a.html', html('fail'));
        await worker.check('a.html', html('crash'));
        await worker.check('a.html', html('hang'));

        const paused = await worker.check('a.html', html('ok'));
        const otherEngine = await worker.check('a.vue', { languageId: 'vue', text: 'ok' });

        assert.deepStrictEqual(paused, {
            status: 'paused',
            reason: 'The html engine failed 3 times within 3 minutes and is paused for this session',
            deadlineExceeded: false
        });
        assert.strictEqual(echoed(otherEngine).text, 'ok');
    });

    it('keeps an engine running when its failures are spread over more than 3 minutes', async () => {
        let now = 0;
        worker = new AnalysisWorker(FAKE_ENGINE, { now: () => now });
        await worker.check('a.html', html('fail'));
        now = 60_000;
        await worker.check('a.html', html('fail'));
        now = 180_001;
        await worker.check('a.html', html('fail'));

        const outcome = await worker.check('a.html', html('ok'));

        assert.strictEqual(echoed(outcome).text, 'ok');
    });

    it('lets the process exit while the worker is idle', () => {
        worker = new AnalysisWorker(FAKE_ENGINE);
        const script = path.join(__dirname, 'fixtures', 'check-and-exit.ts');

        // Times out instead of exiting when the idle worker keeps the process alive
        execFileSync(process.execPath, ['-r', 'ts-node/register', script, FAKE_ENGINE], { timeout: 15_000 });
    });
});
