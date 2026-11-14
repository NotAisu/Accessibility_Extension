import * as assert from 'assert';
import { checkHtml } from '../../src/core/html-check';

describe('checkHtml', () => {
    it('does not execute scripts from the checked file', async () => {
        const html = [
            '<!DOCTYPE html>',
            '<html lang="en"><head><title>t</title></head><body><main>',
            '<img src="chart.png">',
            "<script>document.querySelector('img').setAttribute('alt', 'Chart');</script>",
            '</main></body></html>'
        ].join('\n');

        const findings = await checkHtml(html);

        const imageAlt = findings.find(f => f.originalRuleId === 'image-alt');
        assert.ok(imageAlt, 'expected an image-alt finding; the script must not have added the alt text');
        assert.strictEqual(html.slice(imageAlt.start, imageAlt.end), '<img src="chart.png">');
        assert.strictEqual(imageAlt.ruleId, '1.1.1');
    });
});
