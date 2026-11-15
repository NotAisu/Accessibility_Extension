import * as assert from 'assert';
import { analyse } from '../../src/core/analysis';
import { ignoreComment } from '../../src/core/ignore';

const page = (body: string) => [
    '<!DOCTYPE html>',
    '<html lang="en"><head><title>t</title></head><body><main>',
    body,
    '</main></body></html>'
].join('\n');

describe('ignore comments', () => {
    it('ignore the named rule\'s Findings on the next line of HTML', async () => {
        const text = page([
            '<!-- allyproof-ignore image-alt -->',
            '<img src="decorative.png">',
            '<img src="chart.png">'
        ].join('\n'));

        const { findings } = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(findings.map(f => text.slice(f.range.start, f.range.end)), ['<img src="chart.png">']);
    });

    it('ignore the named rule\'s Findings on the next line of JSX, in an expression comment', async () => {
        const text = [
            'export const Charts = () => (',
            '    <div>',
            '        {/* allyproof-ignore jsx-a11y-x/alt-text */}',
            '        <img src={decorative} />',
            '        <img src={chart} />',
            '    </div>',
            ');',
            ''
        ].join('\n');

        const { findings } = await analyse({ languageId: 'typescriptreact', text });

        assert.deepStrictEqual(findings.map(f => text.slice(f.range.start, f.range.end)), ['<img src={chart} />']);
    });

    for (const [languageId, text, ruleId, element] of [
        ['vue', '<template>\n    <!-- allyproof-ignore vuejs-accessibility/alt-text -->\n    <img :src="decorative">\n    <img :src="chart">\n</template>\n', 'vuejs-accessibility/alt-text', '<img :src="chart">'],
        ['svelte', '<script>\n    let { decorative, chart } = $props();\n</script>\n\n<!-- allyproof-ignore svelte/a11y_missing_attribute -->\n<img src={decorative}>\n<img src={chart}>\n', 'svelte/a11y_missing_attribute', '<img src={chart}>']
    ]) {
        it(`ignore the named rule's Findings on the next line of ${languageId}, in a markup comment`, async () => {
            const { findings } = await analyse({ languageId, text });

            assert.deepStrictEqual(findings.map(f => [f.ruleId, text.slice(f.range.start, f.range.end)]), [[ruleId, element]]);
        });
    }

    it('ignore the next line below a stack of ignore comments', async () => {
        const text = page([
            '<!-- allyproof-ignore image-alt -->',
            '<!-- allyproof-ignore @html-eslint/no-positive-tabindex -->',
            '<img src="chart.png" tabindex="3">'
        ].join('\n'));

        const { findings } = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(findings, []);
    });

    it('keep the Findings of rules the comment does not name', async () => {
        const text = page('<!-- allyproof-ignore image-alt -->\n<button tabindex="3">Save</button>');

        const { findings } = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(findings.map(f => f.ruleId), ['@html-eslint/no-positive-tabindex']);
    });
});

describe('ignoreComment', () => {
    for (const [languageId, line] of [
        ['html', '<img src="chart.png">'],
        ['vue', '<template>\n    <img :src="chart">\n</template>'],
        ['svelte', '<img src={chart}>'],
        ['typescriptreact', 'export const Chart = () => (\n    <div>\n        <img src={chart} />\n    </div>\n);']
    ]) {
        it(`writes a ${languageId} comment that ignores the Finding on the line below it`, async () => {
            const text = languageId === 'html' ? page(line) : line;
            const [finding] = (await analyse({ languageId, text })).findings;
            const lineStart = text.lastIndexOf('\n', finding.range.start - 1) + 1;
            const indent = /^\s*/.exec(text.slice(lineStart))![0];

            const ignored = text.slice(0, lineStart) + indent + ignoreComment(languageId, finding.ruleId) + '\n' + text.slice(lineStart);

            assert.deepStrictEqual((await analyse({ languageId, text: ignored })).findings, []);
        });
    }
});

describe('rule settings', () => {
    const text = page('<img src="chart.png">\n<button tabindex="3">Save</button>');

    it('report Check Findings as warnings by default', async () => {
        const { findings } = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.severity]), [
            ['image-alt', 'warning'],
            ['@html-eslint/no-positive-tabindex', 'warning']
        ]);
    });

    it('drop the Findings of a rule set to off', async () => {
        const { findings } = await analyse({ languageId: 'html', text }, { rules: { 'image-alt': 'off' } });

        assert.deepStrictEqual(findings.map(f => f.ruleId), ['@html-eslint/no-positive-tabindex']);
    });

    it('report a rule\'s Findings with the severity it is set to', async () => {
        const { findings } = await analyse({ languageId: 'html', text }, { rules: { 'image-alt': 'error', '@html-eslint/no-positive-tabindex': 'information' } });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.severity]), [
            ['image-alt', 'error'],
            ['@html-eslint/no-positive-tabindex', 'information']
        ]);
    });
});
