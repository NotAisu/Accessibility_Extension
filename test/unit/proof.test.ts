import * as assert from 'assert';
import { analyse } from '../../src/core/analysis';
import { judgeMatches, lowerBound, proofStatus, repeatedEvidence } from '../ground-truth/proof';

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

    it('counts a case whose text repeats an earlier one in the same language once, wherever it was checked in', () => {
        const repeated = repeatedEvidence();

        assert.strictEqual(repeated('vue', 'act/a.vue', '<img>'), undefined);
        assert.strictEqual(repeated('html', 'act/a.html', '<img>'), undefined);
        assert.strictEqual(repeated('vue', 'field/b.vue', '<img>'), 'act/a.vue');
        assert.strictEqual(repeated('vue', 'field/c.vue', '<img alt="">'), undefined);
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

describe('only Proven rules report Findings', () => {
    // vuejs-accessibility/alt-text is a Proven rule in Vue, aria-role is Unproven.
    const text = '<template>\n  <img :src="chart">\n  <div role="bogus">Text</div>\n</template>\n';

    it('reports a Proven rule\'s match as a Finding and an Unproven rule\'s as Needs Review at its element', async () => {
        const { findings, needsReview } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(findings.map(f => f.ruleId), ['vuejs-accessibility/alt-text']);
        const likely = needsReview.filter(e => e.ruleId);
        assert.deepStrictEqual(likely.map(e => [e.ruleId, e.criterion]), [['vuejs-accessibility/aria-role', '4.1.2']]);
        assert.strictEqual(text.slice(likely[0].range!.start, likely[0].range!.end), 'role="bogus"');
        assert.match(likely[0].reason, /^Likely failure, verify: .*not yet a Proven rule/);
    });

    it('lets a setting turn an Unproven rule off, never promote it to Findings', async () => {
        const promoted = await analyse({ languageId: 'vue', text }, { rules: { 'vuejs-accessibility/aria-role': 'error' } });
        const off = await analyse({ languageId: 'vue', text }, { rules: { 'vuejs-accessibility/aria-role': 'off' } });

        assert.deepStrictEqual(promoted.findings.map(f => f.ruleId), ['vuejs-accessibility/alt-text']);
        assert.ok(promoted.needsReview.some(e => e.ruleId === 'vuejs-accessibility/aria-role'));
        assert.ok(!off.needsReview.some(e => e.ruleId));
    });
});
