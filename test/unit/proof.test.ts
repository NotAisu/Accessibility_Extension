import * as assert from 'assert';
import { judgeMatches, lowerBound, proofStatus } from '../ground-truth/proof';

describe('proof of a rule\'s precision', () => {
    describe('the 95 % lower bound clears 0.95', () => {
        it('with 59 correct Findings and no false positive, not with 58', () => {
            assert.ok(lowerBound(59, 59) >= 0.95);
            assert.ok(lowerBound(58, 58) < 0.95);
        });

        it('with 299 correct Findings it clears 0.99', () => {
            assert.ok(lowerBound(299, 299) >= 0.99);
            assert.ok(lowerBound(298, 298) < 0.99);
        });

        it('with one false positive among 94 Findings, not among 92', () => {
            assert.ok(lowerBound(93, 94) >= 0.95);
            assert.ok(lowerBound(91, 92) < 0.95);
        });

        it('is 0 without a correct Finding', () => {
            assert.strictEqual(lowerBound(0, 0), 0);
            assert.strictEqual(lowerBound(0, 5), 0);
        });
    });

    describe('judging a rule\'s matches against a case', () => {
        const match = (ruleId: string, line: number, criteria: string[]) => ({ ruleId, line, criteria });

        it('counts a match on a labelled line as correct and one on another line as wrong', () => {
            const judged = judgeMatches({ expect: [{ criterion: '1.1.1', line: 3 }] }, [match('alt', 3, ['1.1.1']), match('alt', 5, ['1.1.1'])]);
            assert.deepStrictEqual(judged.get('alt'), { correct: 1, wrong: 1 });
        });

        it('counts a match as correct when any of its criteria fails there', () => {
            const judged = judgeMatches({ expect: [{ criterion: '4.1.2', present: true }, { criterion: '1.3.1', present: false }] }, [match('label', 1, ['1.3.1', '4.1.2'])]);
            assert.deepStrictEqual(judged.get('label'), { correct: 1, wrong: 0 });
        });

        it('leaves a match unjudged when the case says nothing about its criteria', () => {
            const judged = judgeMatches({ expect: [{ criterion: '1.1.1', present: false }] }, [match('lang', 1, ['3.1.1'])]);
            assert.strictEqual(judged.get('lang'), undefined);
        });

        it('counts every unlabelled match on a completely labelled case as wrong', () => {
            const judged = judgeMatches({ complete: true, expect: [] }, [match('lang', 1, ['3.1.1'])]);
            assert.deepStrictEqual(judged.get('lang'), { correct: 0, wrong: 1 });
        });
    });

    it('proves a rule per language only on its own evidence', () => {
        const status = proofStatus(new Map([
            ['html', new Map([['image-alt', { correct: 59, wrong: 0 }], ['label', { correct: 10, wrong: 0 }]])],
            ['vue', new Map([['image-alt', { correct: 3, wrong: 1 }]])]
        ]));
        assert.strictEqual(status.rules['image-alt'].html.proven, true);
        assert.strictEqual(status.rules['image-alt'].vue.proven, false);
        assert.strictEqual(status.rules.label.html.proven, false);
    });
});
