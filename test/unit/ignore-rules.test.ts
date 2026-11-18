import * as assert from 'assert';
import { AnalysisDocument, Finding, ParseError } from '../../src/core/analysis';
import { analyse } from './every-rule';
import { ignoreLine } from '../../src/core/ignore';

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

// The Check as the code actions use it: no Findings when the document does not parse
async function check(document: AnalysisDocument): Promise<Finding[] | undefined> {
    try {
        return (await analyse(document)).findings;
    } catch (error) {
        if (error instanceof ParseError) return undefined;
        throw error;
    }
}

// The text with the ignore line for its first Finding inserted, or undefined when none is offered
async function ignored(languageId: string, text: string): Promise<string | undefined> {
    const [finding] = (await analyse({ languageId, text })).findings;
    assert.ok(finding, 'a Finding to ignore');
    const line = await ignoreLine({ languageId, text }, finding, check);
    return line && text.slice(0, line.offset) + line.text + text.slice(line.offset);
}

describe('ignoreLine', () => {
    for (const [languageId, text, comment] of [
        ['html', page('<img src="chart.png">'), '<!-- allyproof-ignore image-alt -->'],
        ['vue', '<template>\n    <img :src="chart">\n</template>', '<!-- allyproof-ignore vuejs-accessibility/alt-text -->'],
        ['svelte', '<img src={chart}>', '<!-- allyproof-ignore svelte/a11y_missing_attribute -->'],
        ['typescriptreact', 'export const Chart = () => (\n    <div>\n        <img src={chart} />\n    </div>\n);', '{/* allyproof-ignore jsx-a11y-x/alt-text */}'],
        ['typescriptreact', 'export function Chart() {\n    return (\n        <img src={chart} />\n    );\n}', '/* allyproof-ignore jsx-a11y-x/alt-text */'],
        ['javascriptreact', 'export const Save = () => (\n    <div>\n        <button\n            tabIndex={3}\n        >Save</button>\n    </div>\n);', '/* allyproof-ignore jsx-a11y-x/tabindex-no-positive */'],
        ['typescript', "@Component({\n    selector: 'app-chart',\n    template: `\n        <img src=\"chart.png\">\n    `\n})\nexport class Chart {}", '<!-- allyproof-ignore @angular-eslint/template/alt-text -->']
    ]) {
        it(`writes a ${languageId} comment that keeps the code valid and ignores the Finding: ${comment}`, async () => {
            const edited = await ignored(languageId, text);

            assert.ok(edited?.includes(comment), edited);
            assert.deepStrictEqual(await check({ languageId, text: edited! }), []);
        });
    }

    it('offers no ignore line where no comment is valid, above a one-line Angular template', async () => {
        const text = "@Component({\n    selector: 'app-chart',\n    template: '<img src=\"chart.png\">'\n})\nexport class Chart {}";

        assert.strictEqual(await ignored('typescript', text), undefined);
    });
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
