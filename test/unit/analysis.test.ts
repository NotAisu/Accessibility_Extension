import * as assert from 'assert';
import { analyse } from '../../src/core/analysis';

const page = (body: string) => [
    '<!DOCTYPE html>',
    '<html lang="en"><head><title>t</title></head><body><main>',
    body,
    '</main></body></html>'
].join('\n');

describe('analyse (HTML)', () => {
    it('reports a Check Finding at the exact source range of the element', async () => {
        const text = page('<p>Sales</p>\n<img src="chart.png">');

        const { findings } = await analyse({ languageId: 'html', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), '<img src="chart.png">');
        assert.deepStrictEqual(finding.criteria, ['1.1.1']);
        assert.strictEqual(finding.ruleId, 'image-alt');
        assert.strictEqual(finding.layer, 'check');
        assert.strictEqual(finding.severity, 'warning');
        assert.match(finding.message, /alternative text/i);
        assert.match(finding.explanation, /alt attribute/i);
        assert.match(finding.helpUrl, /^https:\/\/dequeuniversity\.com\/rules\/axe\/.*image-alt/);
    });

    it('never executes scripts from the checked file', async () => {
        const text = page([
            '<img src="chart.png">',
            "<script>document.querySelector('img').setAttribute('alt', 'Chart');</script>"
        ].join('\n'));

        const { findings } = await analyse({ languageId: 'html', text });

        assert.ok(findings.some(f => f.ruleId === 'image-alt'), 'the script must not have added the alt text');
    });

    it('reports @html-eslint rules axe-core does not run', async () => {
        const text = page('<button tabindex="3">Save</button>');

        const { findings } = await analyse({ languageId: 'html', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(finding.ruleId, '@html-eslint/no-positive-tabindex');
        assert.deepStrictEqual(finding.criteria, ['2.4.3']);
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), 'tabindex="3"');
        assert.strictEqual(finding.helpUrl, 'https://html-eslint.org/docs/rules/no-positive-tabindex');
    });

    it('lists layout-dependent criteria as Needs Review instead of reporting them', async () => {
        const text = page('<p style="color:#eee;background:#fff">Faint</p>\n<button style="width:8px;height:8px">x</button>');

        const { findings, needsReview } = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(findings, []);
        assert.deepStrictEqual(needsReview.map(entry => entry.criterion), ['1.4.3', '2.5.8']);
    });

    it('returns nothing for languages without a Check yet', async () => {
        const result = await analyse({ languageId: 'vue', text: '<template><img src="a.png"></template>' });

        assert.deepStrictEqual(result, { findings: [], needsReview: [] });
    });
});

