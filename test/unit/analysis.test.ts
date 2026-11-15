import * as assert from 'assert';
import { analyse, ParseError } from '../../src/core/analysis';

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
        const result = await analyse({ languageId: 'plaintext', text: '<img src="a.png">' });

        assert.deepStrictEqual(result, { findings: [], needsReview: [] });
    });
});

describe('analyse (JSX/TSX)', () => {
    it('reports a Check Finding at the exact source range of the JSX element', async () => {
        const text = 'export const Chart = () => (\n    <img src={chart} />\n);\n';

        const { findings } = await analyse({ languageId: 'javascriptreact', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), '<img src={chart} />');
        assert.deepStrictEqual(finding.criteria, ['1.1.1']);
        assert.strictEqual(finding.ruleId, 'jsx-a11y-x/alt-text');
        assert.strictEqual(finding.layer, 'check');
        assert.strictEqual(finding.severity, 'warning');
        assert.match(finding.message, /alt prop/);
        assert.match(finding.helpUrl, /^https:\/\/github\.com\/.*alt-text\.md$/);
    });

    it('parses TypeScript syntax in TSX', async () => {
        const text = 'type Props = { src: string };\nexport const Chart = ({ src }: Props) => <img src={src} />;\n';

        const { findings } = await analyse({ languageId: 'typescriptreact', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, text.slice(f.range.start, f.range.end)]), [
            ['jsx-a11y-x/alt-text', '<img src={src} />']
        ]);
    });

    it('maps each rule to its WCAG criterion', async () => {
        const text = [
            'export const Page = () => (',
            '    <main>',
            '        <a href="/home" />',
            '        <div onClick={open}>Open</div>',
            '        <input type="email" autoComplete="emial" />',
            '        <span tabIndex={2}>x</span>',
            '    </main>',
            ');'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'javascriptreact', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.criteria]), [
            ['jsx-a11y-x/anchor-has-content', ['2.4.4', '4.1.2']],
            ['jsx-a11y-x/click-events-have-key-events', ['2.1.1']],
            ['jsx-a11y-x/no-static-element-interactions', ['4.1.2']],
            ['jsx-a11y-x/autocomplete-valid', ['1.3.5']],
            ['jsx-a11y-x/tabindex-no-positive', ['2.4.3']]
        ]);
    });

    it('still checks JSX after an HTML Check in the same process', async () => {
        await analyse({ languageId: 'html', text: page('<input type="email" autocomplete="email">') });

        const { findings } = await analyse({ languageId: 'javascriptreact', text: '<input type="email" autoComplete="emial" />;' });

        assert.deepStrictEqual(findings.map(f => f.ruleId), ['jsx-a11y-x/autocomplete-valid']);
    });

    it('keeps the other rules\' Findings when one rule crashes on the document', async () => {
        // eslint-plugin-jsx-a11y-x's lang rule throws on a lang attribute without a value
        const text = '<html lang><img src="a.png" /></html>;';

        const { findings } = await analyse({ languageId: 'javascriptreact', text });

        assert.ok(findings.some(f => f.ruleId === 'jsx-a11y-x/alt-text'));
    });

    it('lists contrast and target size as Needs Review for rendered text and controls', async () => {
        const text = 'export const Save = ({ label }) => (\n    <form>\n        <p>{label}</p>\n        <button type="submit">Save</button>\n    </form>\n);\n';

        const { needsReview } = await analyse({ languageId: 'javascriptreact', text });

        assert.deepStrictEqual(needsReview.map(entry => entry.criterion), ['1.4.3', '2.5.8']);
        assert.ok(needsReview.every(entry => entry.reason.length > 0));
    });

    it('lists no Needs Review when nothing renders text or a control', async () => {
        const text = 'export const Logo = () => <img src="logo.png" alt="" />;\nexport const Spacer = () => <div className="gap" />;\n';

        const { needsReview } = await analyse({ languageId: 'typescriptreact', text });

        assert.deepStrictEqual(needsReview, []);
    });

    it('fails on unparseable code instead of reporting no Findings', async () => {
        await assert.rejects(analyse({ languageId: 'javascriptreact', text: 'const a = () => <div><img src="x" /> <' }), ParseError);
    });

    it('places Findings after every line break ESLint counts', async () => {
        for (const lineBreak of ['\r', '\u2028', '\u2029']) {
            const text = `/* a${lineBreak}b */\n<img src="x" />;`;

            const { findings } = await analyse({ languageId: 'javascriptreact', text });

            assert.strictEqual(text.slice(findings[0].range.start, findings[0].range.end), '<img src="x" />');
        }
    });
});

describe('analyse (Vue)', () => {
    it('reports a Check Finding at the exact source range of the template element', async () => {
        const text = '<template>\n    <img :src="chart">\n</template>\n';

        const { findings } = await analyse({ languageId: 'vue', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), '<img :src="chart">');
        assert.deepStrictEqual(finding.criteria, ['1.1.1']);
        assert.strictEqual(finding.ruleId, 'vuejs-accessibility/alt-text');
        assert.strictEqual(finding.layer, 'check');
        assert.strictEqual(finding.severity, 'warning');
        assert.match(finding.message, /alt prop/);
        assert.strictEqual(finding.helpUrl, 'https://vue-a11y.github.io/eslint-plugin-vuejs-accessibility/rules/alt-text.html');
    });

    it('parses <script lang="ts"> with the TypeScript parser', async () => {
        const text = [
            '<script setup lang="ts">',
            'const props = defineProps<{ src: string }>();',
            'const label = (n: number): string => `#${n}`;',
            '</script>',
            '<template><img :src="props.src as string"></template>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, text.slice(f.range.start, f.range.end)]), [
            ['vuejs-accessibility/alt-text', '<img :src="props.src as string">']
        ]);
    });

    it('maps each rule to its WCAG criterion, reading directives and bindings', async () => {
        const text = [
            '<template>',
            '    <main>',
            '        <a href="/home"></a>',
            '        <div @click="open">Open</div>',
            '        <span :tabindex="2">x</span>',
            '        <input type="text" v-model="name">',
            '        <img :alt="caption" :src="src">',
            '    </main>',
            '</template>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.criteria]), [
            ['vuejs-accessibility/anchor-has-content', ['2.4.4', '4.1.2']],
            ['vuejs-accessibility/click-events-have-key-events', ['2.1.1']],
            ['vuejs-accessibility/no-static-element-interactions', ['4.1.2']],
            ['vuejs-accessibility/tabindex-no-positive', ['2.4.3']],
            ['vuejs-accessibility/form-control-has-label', ['4.1.2', '1.3.1']]
        ]);
    });

    it('fails on an unparseable script instead of reporting no Findings', async () => {
        await assert.rejects(analyse({ languageId: 'vue', text: '<script>const a = ;</script>\n<template><img src="x"></template>' }), ParseError);
    });
});

