import * as assert from 'assert';
import { setTimeout as sleep } from 'timers/promises';
import type { CheckOutcome } from '../../src/analysis-worker';
import { CheckSchedule } from '../../src/check-schedule';

const done = (durationMs: number, firstLoad = false): CheckOutcome =>
    ({ status: 'done', result: { findings: [], needsReview: [] }, durationMs, firstLoad });

describe('CheckSchedule', () => {
    let schedule: CheckSchedule;
    afterEach(() => schedule.dispose());

    it('checks a changed document once, after it stopped changing for the debounce time', async () => {
        schedule = new CheckSchedule({ debounceMs: 50 });
        let checks = 0;

        schedule.changed('a', () => checks++);
        await sleep(30);
        schedule.changed('a', () => checks++);
        await sleep(30);
        const whileTyping = checks;
        await sleep(40);

        assert.strictEqual(whileTyping, 0);
        assert.strictEqual(checks, 1);
    });

    it('debounces each document on its own', async () => {
        schedule = new CheckSchedule({ debounceMs: 20 });
        const checked: string[] = [];

        schedule.changed('a', () => checked.push('a'));
        schedule.changed('b', () => checked.push('b'));
        await sleep(50);

        assert.deepStrictEqual(checked.sort(), ['a', 'b']);
    });

    it('checks a document whose last warm run was over the budget on save only', async () => {
        schedule = new CheckSchedule({ debounceMs: 10, budgetMs: 150 });
        let checks = 0;

        schedule.measured('a', done(151));
        schedule.changed('a', () => checks++);
        await sleep(30);

        assert.strictEqual(checks, 0);
        assert.strictEqual(schedule.mayCheck('a', { unsaved: true }), false);
        assert.strictEqual(schedule.mayCheck('a', { unsaved: false }), true);
    });

    it('checks a document on change again once a warm run is within the budget', () => {
        schedule = new CheckSchedule({ budgetMs: 150 });

        schedule.measured('a', done(400));
        schedule.measured('a', done(20));

        assert.strictEqual(schedule.mayCheck('a', { unsaved: true }), true);
    });

    it('does not judge a run that also loaded its engine', () => {
        schedule = new CheckSchedule({ budgetMs: 150 });

        schedule.measured('a', done(2000, true));

        assert.strictEqual(schedule.mayCheck('a', { unsaved: true }), true);
    });

    it('checks a document whose Check missed its deadline on save only', () => {
        schedule = new CheckSchedule();

        schedule.measured('a', { status: 'paused', reason: 'The Check took longer than 1000 ms', deadlineExceeded: true });

        assert.strictEqual(schedule.mayCheck('a', { unsaved: true }), false);
    });

    it('tells whether a document is checked on save only, whose Check then gets the background deadline', () => {
        schedule = new CheckSchedule({ budgetMs: 150 });

        schedule.measured('a', done(400));
        schedule.measured('b', done(20));

        assert.strictEqual(schedule.onSaveOnly('a'), true);
        assert.strictEqual(schedule.onSaveOnly('b'), false);
    });

    it('knows which version of a document was checked, so showing it again does not check it again', () => {
        schedule = new CheckSchedule();

        schedule.checked('a', 3);

        assert.strictEqual(schedule.isCurrent('a', 3), true);
        assert.strictEqual(schedule.isCurrent('a', 4), false);
        assert.strictEqual(schedule.isCurrent('b', 1), false);
        schedule.delete('a');
        assert.strictEqual(schedule.isCurrent('a', 3), false);
    });

    it('forgets a closed document: no pending check, on change again when reopened', async () => {
        schedule = new CheckSchedule({ debounceMs: 10 });
        let checks = 0;
        schedule.measured('a', done(500));
        schedule.changed('b', () => checks++);

        schedule.delete('a');
        schedule.delete('b');
        await sleep(30);

        assert.strictEqual(checks, 0);
        assert.strictEqual(schedule.mayCheck('a', { unsaved: true }), true);
    });
});
