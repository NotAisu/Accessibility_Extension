import * as assert from 'assert';
import { BenchCase, BenchResult, chooseWinner, runBenchmark } from '../bench/benchmark';
import type { ModelPort, ModelRequest } from '../../src/review/ai-review';

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
});
