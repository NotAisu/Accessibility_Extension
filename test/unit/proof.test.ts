import * as assert from 'assert';
import { analyse } from '../../src/core/analysis';
import { BEST_PRACTICE_RULES, judgeMatches, lowerBound, proofStatus, repeatedEvidence } from '../ground-truth/proof';

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
        const fails = [{ ruleId: 'image-alt', line: 1 }];

        assert.strictEqual(repeated('vue', 'act/a.vue', '<img>', fails), undefined);
        assert.strictEqual(repeated('html', 'act/a.html', '<img>', fails), undefined);
        assert.strictEqual(repeated('vue', 'field/b.vue', '<img>', fails), 'act/a.vue');
        assert.strictEqual(repeated('vue', 'field/c.vue', '<img alt="">', []), undefined);
    });

    it('fails on a repeated case whose labels disagree with the earlier one', () => {
        const repeated = repeatedEvidence();
        repeated('vue', 'act/a.vue', '<img>', [{ ruleId: 'image-alt', line: 1 }]);

        assert.throws(() => repeated('vue', 'field/b.vue', '<img>', []), /field\/b\.vue and act\/a\.vue have the same text but different labels/);
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

    it('never proves a Best-practice rule, whatever its evidence', () => {
        const status = proofStatus(new Map([
            ['javascriptreact', new Map([['jsx-a11y-x/tabindex-no-positive', { correct: 300, wrong: 0 }], ['jsx-a11y-x/alt-text', { correct: 300, wrong: 0 }]])],
            ['vue', new Map([['jsx-a11y-x/tabindex-no-positive', { correct: 300, wrong: 0 }]])]
        ]), { javascriptreact: ['jsx-a11y-x/tabindex-no-positive'] });
        assert.strictEqual(status.rules['jsx-a11y-x/tabindex-no-positive'].javascriptreact.proven, false);
        assert.strictEqual(status.rules['jsx-a11y-x/tabindex-no-positive'].vue.proven, true);
        assert.strictEqual(status.rules['jsx-a11y-x/alt-text'].javascriptreact.proven, true);
    });

    it('marks positive tabindex and ambiguous link text as Best-practice rules in the bundled list', () => {
        assert.ok(BEST_PRACTICE_RULES.html.includes('@html-eslint/no-positive-tabindex'));
        assert.ok(BEST_PRACTICE_RULES.typescriptreact.includes('jsx-a11y-x/anchor-ambiguous-text'));
        assert.ok(BEST_PRACTICE_RULES.astro.includes('astro/jsx-a11y/anchor-ambiguous-text'));
        const status = proofStatus(new Map([['html', new Map([['@html-eslint/no-positive-tabindex', { correct: 300, wrong: 0 }]])]]));
        assert.strictEqual(status.rules['@html-eslint/no-positive-tabindex'].html.proven, false);
    });
});

describe('only Proven rules report Findings', () => {
    // vuejs-accessibility/alt-text is a Proven rule in Vue, no-distracting-elements is Unproven.
    const text = '<template>\n  <img :src="chart">\n  <marquee>Text</marquee>\n</template>\n';

    it('reports a Proven rule\'s match as a Finding and an Unproven rule\'s as Needs Review at its element', async () => {
        const { findings, needsReview } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(findings.map(f => f.ruleId), ['vuejs-accessibility/alt-text']);
        const likely = needsReview.filter(e => e.ruleId);
        assert.deepStrictEqual(likely.map(e => [e.ruleId, e.criterion]), [['vuejs-accessibility/no-distracting-elements', '2.2.2']]);
        assert.strictEqual(text.slice(likely[0].range!.start, likely[0].range!.end), '<marquee>Text</marquee>');
        assert.match(likely[0].reason, /^Likely failure, verify: .*not yet a Proven rule/);
    });

    describe('a Best-practice rule\'s match stays Needs Review at its element, named a convention', () => {
        const cases: [string, string, string, string][] = [
            ['html', '<!DOCTYPE html>\n<html lang="en"><head><title>t</title></head><body><main><button tabindex="3">Save</button></main></body></html>', '@html-eslint/no-positive-tabindex', 'tabindex="3"'],
            ['javascriptreact', 'export const A = () => <a href="/news">click here</a>;\n', 'jsx-a11y-x/anchor-ambiguous-text', '<a href="/news">'],
            ['typescriptreact', 'export const A = () => <button tabIndex={2}>Save</button>;\n', 'jsx-a11y-x/tabindex-no-positive', 'tabIndex={2}'],
            ['vue', '<template>\n  <button tabindex="2">Save</button>\n</template>\n', 'vuejs-accessibility/tabindex-no-positive', '<button tabindex="2">Save</button>'],
            ['svelte', '<button tabindex="2">Save</button>\n', 'svelte/a11y_positive_tabindex', 'tabindex="2"'],
            ['angular', '<button tabindex="2">Save</button>\n', '@angular-eslint/template/no-positive-tabindex', '2'],
            ['astro', '---\n---\n<a href="/news">click here</a>\n', 'astro/jsx-a11y/anchor-ambiguous-text', '<a href="/news">']
        ];
        for (const [languageId, text, ruleId, element] of cases) {
            it(`${ruleId} in ${languageId}`, async () => {
                const { findings, needsReview } = await analyse({ languageId, text }, { rules: { [ruleId]: 'error' } });

                assert.ok(!findings.some(f => f.ruleId === ruleId));
                const entries = needsReview.filter(e => e.ruleId === ruleId);
                assert.strictEqual(entries.length, 1);
                assert.strictEqual(text.slice(entries[0].range!.start, entries[0].range!.end), element);
                assert.match(entries[0].reason, /Best-practice rule.*convention/);
            });
        }
    });

    it('lets a setting turn an Unproven rule off, never promote it to Findings', async () => {
        const promoted = await analyse({ languageId: 'vue', text }, { rules: { 'vuejs-accessibility/no-distracting-elements': 'error' } });
        const off = await analyse({ languageId: 'vue', text }, { rules: { 'vuejs-accessibility/no-distracting-elements': 'off' } });

        assert.deepStrictEqual(promoted.findings.map(f => f.ruleId), ['vuejs-accessibility/alt-text']);
        assert.ok(promoted.needsReview.some(e => e.ruleId === 'vuejs-accessibility/no-distracting-elements'));
        assert.ok(!off.needsReview.some(e => e.ruleId));
    });
});
