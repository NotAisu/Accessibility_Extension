import * as assert from 'assert';
import { BenchCase, BenchResult, chooseWinner, runBenchmark, sampleCases } from '../bench/benchmark';
import { actWrapperCases, parseAccessGuruCsv } from '../bench/data';
import { ModelError, ModelPort, ModelRequest } from '../../src/review/ai-review';

const failing = (id: string, text: string, criteria: string[]): BenchCase =>
    ({ id, source: 'test', synthetic: false, languageId: 'html', text, criteria, failing: true });
const passing = (id: string, text: string, criteria: string[]): BenchCase =>
    ({ ...failing(id, text, criteria), failing: false });

/** Reports a Finding on line 1 for each `report:<criterion>` marker in the reviewed code. */
function fakeModel(id = 'fake/model-1'): ModelPort & { requests: ModelRequest[] } {
    const requests: ModelRequest[] = [];
    return {
        id,
        name: 'Fake Model',
        maxInputTokens: 100_000,
        countTokens: text => Promise.resolve(text.length),
        requests,
        request(request) {
            requests.push(request);
            const criteria = [...request.messages[1].matchAll(/report:(\d+\.\d+\.\d+)/g)].map(m => m[1]);
            return Promise.resolve({
                findings: criteria.map(criterion => ({ line: 1, criterion, message: 'A problem.', recommendation: 'Fix it.', confidence: 0.9 }))
            });
        }
    };
}

describe('AI benchmark', () => {
    it('scores recall and precision per Skill Variant and model against the cases', async () => {
        const cases = [
            failing('found', '<a href="/p">click here</a> report:2.4.4', ['2.4.4']),
            failing('missed', '<img alt="image" src="a.png">', ['1.1.1']),
            failing('other criterion', '<h1>Title</h1> report:1.3.1', ['2.4.6']),
            passing('false positive', '<a href="/p">Products</a> report:2.4.4', ['2.4.4']),
            passing('quiet', '<a href="/q">Prices</a>', ['2.4.4'])
        ];

        const [result] = await runBenchmark(cases, [{ name: 'shipped', text: 'Review it.' }], [fakeModel()]);

        assert.strictEqual(result.variant, 'shipped');
        assert.strictEqual(result.model, 'fake/model-1');
        // The 1.3.1 Finding on the case labelled 2.4.6 misses it and is a false positive
        assert.deepStrictEqual({ tp: result.tp, fp: result.fp, fn: result.fn }, { tp: 1, fp: 2, fn: 2 });
        assert.strictEqual(result.recall, 1 / 3);
        assert.strictEqual(result.precision, 1 / 3);
    });

    it('counts a Finding outside a failing case\'s criteria as a false positive, even next to a hit', async () => {
        const cases = [failing('found and more', '<a href="/p">click here</a> report:2.4.4 report:1.3.1', ['2.4.4'])];

        const [result] = await runBenchmark(cases, [{ name: 'shipped', text: 'Review it.' }], [fakeModel()]);

        assert.deepStrictEqual({ tp: result.tp, fp: result.fp, fn: result.fn }, { tp: 1, fp: 1, fn: 0 });
    });

    it('counts the tokens each Variant spends on each model, input and output', async () => {
        const cases = [failing('found', '<a href="/p">click here</a> report:2.4.4', ['2.4.4'])];
        const models = [fakeModel('fake/a'), fakeModel('fake/b')];

        const results = await runBenchmark(cases, [{ name: 'long', text: 'x'.repeat(1000) }, { name: 'short', text: 'x' }], models);

        assert.deepStrictEqual(results.map(r => [r.variant, r.model]), [['long', 'fake/a'], ['short', 'fake/a'], ['long', 'fake/b'], ['short', 'fake/b']]);
        const [long, short] = results;
        // The fake tokenizer counts characters: the long Variant sends 999 more of them
        assert.strictEqual(long.tokens - short.tokens, 999);
        const request = models[0].requests[1];
        const output = JSON.stringify({ findings: [{ line: 1, criterion: '2.4.4', message: 'A problem.', recommendation: 'Fix it.', confidence: 0.9 }] });
        assert.strictEqual(short.tokens, request.messages.join('\n').length + output.length);
    });

    describe('winner', () => {
        const result = (variant: string, model: string, tp: number, fp: number, fn: number, tokens: number): BenchResult =>
            ({ variant, model, tp, fp, fn, tokens, errors: 0, recall: tp / (tp + fn), precision: tp / (tp + fp) });

        it('is the Variant with the highest recall over all models', () => {
            const winner = chooseWinner([
                result('a', 'm1', 8, 1, 2, 100), result('a', 'm2', 6, 1, 4, 100),
                result('b', 'm1', 9, 1, 1, 900), result('b', 'm2', 7, 1, 3, 900)
            ]);

            assert.strictEqual(winner?.variant, 'b');
            assert.strictEqual(winner?.recall, 16 / 20);
            assert.strictEqual(winner?.tokens, 1800);
        });

        it('needs a precision of at least 0.8', () => {
            const winner = chooseWinner([result('loud', 'm1', 10, 3, 0, 100), result('exact', 'm1', 8, 2, 2, 100)]);

            assert.strictEqual(winner?.variant, 'exact');
        });

        it('breaks a tie in recall with fewer tokens', () => {
            const winner = chooseWinner([result('long', 'm1', 8, 1, 2, 900), result('short', 'm1', 8, 2, 2, 300)]);

            assert.strictEqual(winner?.variant, 'short');
        });

        it('is none when no Variant reaches the precision', () => {
            assert.strictEqual(chooseWinner([result('a', 'm1', 5, 5, 0, 100), result('b', 'm1', 0, 0, 10, 100)]), undefined);
        });
    });

    describe('benchmark data', () => {
        it('parses AccessGuru CSV rows, strips the violation marker and marks them non-synthetic', () => {
            const csv = [
                '#,Violation Type,Affected HTML',
                '1,link-text-mismatch,"<div>\n<! –– Accessibility Violation starts here ––><a href=""/p"">click here</a>\n</div>"',
                '2,image-alt-not-descriptive,<img src="a.png" alt="image">'
            ].join('\r\n');

            const cases = parseAccessGuruCsv(csv);

            assert.strictEqual(cases.length, 2);
            assert.deepStrictEqual(cases[0], {
                id: 'accessguru-1',
                source: 'AccessGuru link-text-mismatch',
                synthetic: false,
                languageId: 'html',
                text: '<div>\n<a href="/p">click here</a>\n</div>',
                criteria: ['2.4.4'],
                failing: true
            });
            assert.deepStrictEqual(cases[1].criteria, ['1.1.1']);
            assert.strictEqual(cases[1].synthetic, false);
        });

        it('rejects an AccessGuru row with an unmapped violation type', () => {
            const csv = '#,Violation Type,Affected HTML\n1,unknown-type,<div>hi</div>';
            assert.throws(() => parseAccessGuruCsv(csv), /without criteria: unknown-type/);
        });

        it('wraps vendored ACT judgment cases into Vue and Svelte components marked synthetic', () => {
            const cases = actWrapperCases();

            assert.ok(cases.length > 0);
            assert.ok(cases.every(c => c.synthetic === true));
            assert.ok(cases.every(c => c.criteria.length > 0));
            assert.ok(cases.some(c => c.languageId === 'vue' && c.text.includes('<template>')));
            assert.ok(cases.some(c => c.languageId === 'svelte'));
            assert.ok(cases.some(c => c.failing) && cases.some(c => !c.failing));
        });

        it('stratifies sampled cases across criteria and failing/passing outcomes', () => {
            const cases: BenchCase[] = [
                { ...failing('a1', '<img alt="x">', ['1.1.1']), source: 'A' },
                { ...failing('a2', '<img alt="y">', ['1.1.1']), source: 'A' },
                { ...failing('b1', '<a href="/">more</a>', ['2.4.4']), source: 'B' },
                { ...passing('b2', '<a href="/">Docs</a>', ['2.4.4']), source: 'B' }
            ];

            const sampled = sampleCases(cases, 3);

            assert.strictEqual(sampled.length, 3);
            assert.deepStrictEqual(sampled.map(c => c.id), ['a1', 'b1', 'b2']);
            assert.strictEqual(sampleCases(cases, Infinity).length, 4);
        });
    });

    it('counts non-cancelled model errors and keeps scoring the remaining cases', async () => {
        let calls = 0;
        const flaky: ModelPort = {
            ...fakeModel(),
            request(request, signal) {
                calls++;
                if (calls === 1) return Promise.reject(new ModelError('Timeout', 'Timed out.'));
                return fakeModel().request(request, signal);
            }
        };
        const cases = [
            failing('first', '<a href="/p">click here</a> report:2.4.4', ['2.4.4']),
            failing('second', '<a href="/p">click here</a> report:2.4.4', ['2.4.4'])
        ];

        const [result] = await runBenchmark(cases, [{ name: 'shipped', text: 'Review it.' }], [flaky]);

        assert.strictEqual(result.errors, 1);
        assert.deepStrictEqual({ tp: result.tp, fp: result.fp, fn: result.fn }, { tp: 1, fp: 0, fn: 1 });
    });

    it('rethrows cancellation instead of counting it as a case error', async () => {
        const cancelled: ModelPort = {
            ...fakeModel(),
            request: () => Promise.reject(new ModelError('Cancelled', 'Cancelled.'))
        };

        await assert.rejects(
            runBenchmark([failing('one', '<a href="/p">click</a>', ['2.4.4'])], [{ name: 'shipped', text: 'Review it.' }], [cancelled]),
            (error: ModelError) => error.code === 'Cancelled'
        );
    });
});
