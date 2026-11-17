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

    it('passes the rule settings to the analysis', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);

        const outcome = await worker.check('a.html', html('options'), { rules: { 'image-alt': 'off' } });

        assert.strictEqual(echoed(outcome).text, '{"rules":{"image-alt":"off"}}');
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

    it('gives an engine\'s first run in a worker, which loads the engine, the longer first-load deadline', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200, firstLoadMs: 2000 });

        const first = await worker.check('a.html', html('slow:400'));
        const warm = await worker.check('a.html', html('slow:400'));
        const otherEngine = await worker.check('a.vue', { languageId: 'vue', text: 'slow:400' });

        assert.strictEqual(echoed(first).text, 'slow:400');
        assert.deepStrictEqual(warm, { status: 'paused', reason: 'The Check took longer than 200 ms', deadlineExceeded: true });
        // The deadline ended the worker, so the next engine loads in a fresh one
        assert.strictEqual(echoed(otherEngine).text, 'slow:400');
    });

    it('gives a background request, such as the Check of a file checked on save only, the longer background deadline', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200, firstLoadMs: 2000, backgroundDeadlineMs: 2000 });
        await worker.check('a.html', html('ok'));

        const background = await worker.check('a.html', html('slow:400'), {}, { background: true });
        const hung = await worker.check('a.html', html('hang'), {}, { background: true });

        assert.strictEqual(echoed(background).text, 'slow:400');
        assert.deepStrictEqual(hung, { status: 'paused', reason: 'The Check took longer than 2000 ms', deadlineExceeded: true });
    });

    it('reports how long each run took and whether it also loaded its engine', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);

        const first = await worker.check('a.html', html('ok'));
        const warm = await worker.check('a.html', html('slow:200'));

        assert.ok(first.status === 'done' && first.firstLoad);
        assert.ok(warm.status === 'done' && !warm.firstLoad && warm.durationMs >= 190, JSON.stringify(warm));
    });

    it('pauses an engine for the session after 3 failures within 3 minutes', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200, firstLoadMs: 200 });
        await worker.check('a.html', html('fail'));
        await worker.check('a.html', html('crash'));
        await worker.check('a.html', html('fail'));

        const paused = await worker.check('a.html', html('ok'));
        const otherEngine = await worker.check('a.vue', { languageId: 'vue', text: 'ok' });

        assert.deepStrictEqual(paused, {
            status: 'paused',
            reason: 'The html engine failed 3 times within 3 minutes and is paused for this session',
            deadlineExceeded: false
        });
        assert.strictEqual(echoed(otherEngine).text, 'ok');
    });

    it('never pauses an engine for deadline overruns, which say a file is large', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200, firstLoadMs: 200 });
        for (let i = 0; i < 3; i++) {
            const overrun = await worker.check(`${i}.html`, html('hang'), {}, { background: i === 0 });
            assert.deepStrictEqual(overrun, { status: 'paused', reason: 'The Check took longer than 200 ms', deadlineExceeded: true });
        }

        const outcome = await worker.check('a.html', html('ok'));

        assert.strictEqual(echoed(outcome).text, 'ok');
        assert.deepStrictEqual(worker.engines().paused, []);
    });

    it('pauses on a parse error without counting it against the engine', async () => {
        worker = new AnalysisWorker(FAKE_ENGINE);
        const parsed = await worker.check('a.html', html('parse'));
        await worker.check('a.html', html('parse'));
        await worker.check('a.html', html('parse'));

        const outcome = await worker.check('a.html', html('ok'));

        assert.deepStrictEqual(parsed, { status: 'paused', reason: 'Parse error at 1:1: Unexpected token "secret"', deadlineExceeded: false });
        assert.strictEqual(echoed(outcome).text, 'ok');
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

    it('logs engine failures, deadlines, crashes and respawns, never the checked text', async () => {
        const lines: string[] = [];
        const log = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`), error: (m: string) => lines.push(`error ${m}`) };
        worker = new AnalysisWorker(FAKE_ENGINE, { deadlineMs: 200, firstLoadMs: 200, log });

        await worker.check('a.html', html('fail'));
        await worker.check('a.html', html('hang'));
        await worker.check('a.vue', { languageId: 'vue', text: 'crash' });
        await worker.check('a.html', html('crash'));
        await worker.check('a.html', html('fail'));
        await worker.check('a.html', html('ok'));

        assert.deepStrictEqual(lines, [
            'info Analysis worker started',
            'error html engine failed: engine failed',
            'warn html Check took longer than 200 ms; the analysis worker is restarted',
            'info Analysis worker started',
            'error vue engine: The analysis worker crashed: engine crashed',
            'info Analysis worker started',
            'error html engine: The analysis worker crashed: engine crashed',
            'info Analysis worker started',
            'error html engine failed: engine failed',
            'error html engine paused for this session after 3 failures within 3 minutes'
        ]);
    });

    it('logs a parse error by language and position only, and caps what an engine error quotes', async () => {
        const lines: string[] = [];
        const log = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`), error: (m: string) => lines.push(`error ${m}`) };
        worker = new AnalysisWorker(FAKE_ENGINE, { log });

        await worker.check('a.svelte', { languageId: 'svelte', text: 'parse' });
        await worker.check('a.html', html('fail-quoting'));

        assert.deepStrictEqual(lines.slice(1, 2), ['warn svelte Check paused: parse error at 1:1']);
        const [, , failure] = lines;
        assert.ok(failure.startsWith('error html engine failed: engine failed on xxx'), failure);
        assert.ok(!failure.includes('secret') && !failure.includes('\n') && failure.length <= 250, failure);
    });

    it('lets the process exit while the worker is idle', () => {
        worker = new AnalysisWorker(FAKE_ENGINE);
        const script = path.join(__dirname, 'fixtures', 'check-and-exit.ts');

        // Times out instead of exiting when the idle worker keeps the process alive
        execFileSync(process.execPath, ['-r', 'ts-node/register', script, FAKE_ENGINE], { timeout: 15_000 });
    });
});
