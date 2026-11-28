import * as assert from 'assert';
import { analyse } from '../../src/core/analysis';
import { analyse as analyseEveryRule } from './every-rule';
import { OPEN_ELEMENT_RULES } from '../../src/core/open-element';

const slice = (text: string, range: { start: number; end: number }) => text.slice(range.start, range.end);

describe('Open element', () => {
    it('exports the affected rules as explicit data', () => {
        assert.ok(OPEN_ELEMENT_RULES instanceof Set);
        assert.ok(OPEN_ELEMENT_RULES.has('jsx-a11y-x/alt-text'));
        assert.ok(OPEN_ELEMENT_RULES.has('jsx-a11y-x/click-events-have-key-events'));
        assert.ok(OPEN_ELEMENT_RULES.has('jsx-a11y-x/no-static-element-interactions'));
        assert.ok(OPEN_ELEMENT_RULES.has('astro/jsx-a11y/alt-text'));
        assert.ok(OPEN_ELEMENT_RULES.has('svelte/a11y_missing_attribute'));
        assert.ok(OPEN_ELEMENT_RULES.has('svelte/a11y_role_supports_aria_props'));
        assert.ok(OPEN_ELEMENT_RULES.has('svelte/a11y_role_supports_aria_props_implicit'));
        assert.ok(OPEN_ELEMENT_RULES.has('vuejs-accessibility/form-control-has-label'));
        assert.ok(OPEN_ELEMENT_RULES.has('vuejs-accessibility/alt-text'));
        assert.ok(OPEN_ELEMENT_RULES.has('vuejs-accessibility/click-events-have-key-events'));
        assert.ok(OPEN_ELEMENT_RULES.has('vuejs-accessibility/iframe-has-title'));
        assert.ok(OPEN_ELEMENT_RULES.has('allyproof/button-name'));
        assert.ok(!OPEN_ELEMENT_RULES.has('jsx-a11y-x/aria-role'));
        assert.ok(!OPEN_ELEMENT_RULES.has('jsx-a11y-x/no-distracting-elements'));
        assert.ok(!OPEN_ELEMENT_RULES.has('svelte/a11y_unknown_role'));
        assert.ok(!OPEN_ELEMENT_RULES.has('svelte/a11y_distracting_elements'));
        assert.ok(!OPEN_ELEMENT_RULES.has('vuejs-accessibility/aria-role'));
        assert.ok(!OPEN_ELEMENT_RULES.has('vuejs-accessibility/no-distracting-elements'));
        assert.ok(!OPEN_ELEMENT_RULES.has('vuejs-accessibility/tabindex-no-positive'));
    });

    for (const languageId of ['javascriptreact', 'typescriptreact'] as const) {
        it(`demotes affected rules on a spread element to Needs Review in ${languageId}, while keeping Findings without spread`, async () => {
            const withSpread = [
                'export const C = (props) => <>',
                '    <img {...props} src="a.png" />',
                '    <div {...props} onClick={open}>Open</div>',
                '    <button {...props} />',
                '</>;'
            ].join('\n');
            const withoutSpread = [
                'export const C = () => <>',
                '    <img src="a.png" />',
                '    <div onClick={open}>Open</div>',
                '    <button />',
                '</>;'
            ].join('\n');

            // Proven rules (alt-text, button-name) and all rules via analyseEveryRule must not report Findings on spread elements
            const spreadResult = await analyse({ languageId, text: withSpread });
            assert.deepStrictEqual(spreadResult.findings, []);

            const spreadAll = await analyseEveryRule({ languageId, text: withSpread });
            assert.deepStrictEqual(spreadAll.findings, []);
            const openEntries = spreadAll.needsReview.filter(e => e.range && /open element/i.test(e.reason));
            assert.deepStrictEqual(
                openEntries.map(e => [e.criterion, slice(withSpread, e.range!)]),
                [
                    ['1.1.1', '<img {...props} src="a.png" />'],
                    ['2.1.1', '<div {...props} onClick={open}>'],
                    ['4.1.2', '<div {...props} onClick={open}>'],
                    ['4.1.2', '<button {...props} />']
                ]
            );
            assert.ok(openEntries.every(e => e.ruleId === undefined), 'Open element Needs Review entries must not be tagged as Unproven rule matches');

            // Without spread, Proven rules still report Findings
            const plainResult = await analyse({ languageId, text: withoutSpread });
            assert.deepStrictEqual(
                plainResult.findings.map(f => [f.ruleId, slice(withoutSpread, f.range)]),
                [
                    ['jsx-a11y-x/alt-text', '<img src="a.png" />'],
                    ['allyproof/button-name', '<button />']
                ]
            );
        });

        it(`keeps Findings for unaffected rules on a spread element and for non-open children in ${languageId}`, async () => {
            const text = [
                'export const C = (props) => <>',
                '    <div role="bogus" {...props}>x</div>',
                '    <div {...props}><img src="nested.png" /></div>',
                '    <div {...props} icon={<img src="prop.png" />} />',
                '</>;'
            ].join('\n');

            const { findings } = await analyse({ languageId, text });
            assert.deepStrictEqual(
                findings.map(f => [f.ruleId, slice(text, f.range)]),
                [
                    ['jsx-a11y-x/aria-role', 'role="bogus"'],
                    ['jsx-a11y-x/alt-text', '<img src="nested.png" />'],
                    ['jsx-a11y-x/alt-text', '<img src="prop.png" />']
                ]
            );
        });
    }

    it('demotes affected rules on a spread element to Needs Review in Astro, while keeping Findings without spread', async () => {
        const withSpread = [
            '---',
            'const props = Astro.props;',
            '---',
            '<img {...props} src="a.png" />',
            '<div {...props} onclick="open()">Open</div>',
            '<button {...props} />'
        ].join('\n');
        const withoutSpread = [
            '---',
            '---',
            '<img src="a.png" />',
            '<button />'
        ].join('\n');

        const spreadResult = await analyse({ languageId: 'astro', text: withSpread });
        assert.deepStrictEqual(spreadResult.findings, []);

        const spreadAll = await analyseEveryRule({ languageId: 'astro', text: withSpread });
        assert.deepStrictEqual(spreadAll.findings, []);
        const openEntries = spreadAll.needsReview.filter(e => e.range && /open element/i.test(e.reason));
        assert.deepStrictEqual(
            openEntries.map(e => [e.criterion, slice(withSpread, e.range!)]),
            [
                ['1.1.1', '<img {...props} src="a.png" />'],
                ['2.1.1', '<div {...props} onclick="open()">'],
                ['4.1.2', '<div {...props} onclick="open()">'],
                ['4.1.2', '<button {...props} />']
            ]
        );
        assert.ok(openEntries.every(e => e.ruleId === undefined));

        const plainResult = await analyse({ languageId: 'astro', text: withoutSpread });
        assert.deepStrictEqual(
            plainResult.findings.map(f => [f.ruleId, slice(withoutSpread, f.range)]),
            [
                ['astro/jsx-a11y/alt-text', '<img src="a.png" />'],
                ['allyproof/button-name', '<button />']
            ]
        );
    });

    it('keeps Findings for unaffected rules on a spread element in Astro', async () => {
        const text = [
            '---',
            'const props = Astro.props;',
            '---',
            '<div role="bogus" {...props}>x</div>',
            '<div {...props}><img src="nested.png" /></div>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'astro', text });
        assert.deepStrictEqual(
            findings.map(f => [f.ruleId, slice(text, f.range)]),
            [
                ['astro/jsx-a11y/aria-role', 'role="bogus"'],
                ['astro/jsx-a11y/alt-text', '<img src="nested.png" />']
            ]
        );
    });

    it('demotes affected rules on a spread element to Needs Review in Svelte, while keeping Findings without spread', async () => {
        const withProps = [
            '<script>let props = $props();</script>',
            '<button {...props} aria-checked="true">Toggle</button>',
            '<div {...props} role="button" aria-checked="true">Toggle</div>'
        ].join('\n');
        const withRestProps = '<button {...$$restProps} aria-checked="true">Toggle</button>';
        const withoutSpread = [
            '<button aria-checked="true">Toggle</button>',
            '<img src="a.png" />'
        ].join('\n');

        const propsResult = await analyse({ languageId: 'svelte', text: withProps });
        assert.deepStrictEqual(propsResult.findings, []);
        const propsOpen = propsResult.needsReview.filter(e => e.range && /open element/i.test(e.reason));
        assert.deepStrictEqual(
            propsOpen.map(e => [e.criterion, slice(withProps, e.range!)]),
            [
                ['4.1.2', '<button {...props} aria-checked="true">'],
                ['4.1.2', '<div {...props} role="button" aria-checked="true">']
            ]
        );
        assert.ok(propsOpen.every(e => e.ruleId === undefined));

        const restResult = await analyse({ languageId: 'svelte', text: withRestProps });
        assert.deepStrictEqual(restResult.findings, []);
        const restOpen = restResult.needsReview.filter(e => e.range && /open element/i.test(e.reason));
        assert.deepStrictEqual(
            restOpen.map(e => [e.criterion, slice(withRestProps, e.range!)]),
            [['4.1.2', '<button {...$$restProps} aria-checked="true">']]
        );
        assert.ok(restOpen.every(e => e.ruleId === undefined));

        const plainResult = await analyse({ languageId: 'svelte', text: withoutSpread });
        assert.deepStrictEqual(
            plainResult.findings.map(f => [f.ruleId, slice(withoutSpread, f.range)]),
            [
                ['svelte/a11y_role_supports_aria_props_implicit', 'aria-checked="true"'],
                ['svelte/a11y_missing_attribute', '<img src="a.png" />']
            ]
        );
    });

    it('keeps Findings for unaffected rules on a spread element and for non-open children in Svelte', async () => {
        const text = [
            '<script>let props = $props();</script>',
            '<div role="bogus" {...props}>x</div>',
            '<div {...props}><img src="nested.png" /></div>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'svelte', text });
        assert.deepStrictEqual(
            findings.map(f => [f.ruleId, slice(text, f.range)]),
            [
                ['svelte/a11y_unknown_role', 'role="bogus"'],
                ['svelte/a11y_missing_attribute', '<img src="nested.png" />']
            ]
        );
    });

    it('keeps Findings for plain Angular elements without object attribute spreads', async () => {
        const text = [
            '<img [src]="photo" [ngClass]="cls">',
            '<button [class.active]="active"></button>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'angular', text });
        assert.deepStrictEqual(
            findings.map(f => [f.ruleId, slice(text, f.range)]),
            [
                ['@angular-eslint/template/alt-text', '<img [src]="photo" [ngClass]="cls">'],
                ['@angular-eslint/template/elements-content', '<button [class.active]="active"></button>']
            ]
        );
    });

    it('demotes affected rules on an element with object v-bind to Needs Review in Vue, while keeping Findings without it', async () => {
        const withVBind = [
            '<template>',
            '    <input type="text" v-bind="obj" />',
            '    <img v-bind="props" src="a.png" />',
            '    <div v-bind="props" @click="open">Open</div>',
            '    <iframe v-bind="props" src="/a"></iframe>',
            '</template>'
        ].join('\n');
        const withoutVBind = [
            '<template>',
            '    <input type="text" />',
            '    <input type="text" :placeholder="hint" />',
            '    <img src="a.png" />',
            '    <iframe src="/a"></iframe>',
            '</template>'
        ].join('\n');

        const boundResult = await analyse({ languageId: 'vue', text: withVBind });
        assert.deepStrictEqual(boundResult.findings, []);

        const boundAll = await analyseEveryRule({ languageId: 'vue', text: withVBind });
        assert.deepStrictEqual(boundAll.findings, []);
        const openEntries = boundAll.needsReview.filter(e => e.range && /open element/i.test(e.reason));
        assert.deepStrictEqual(
            openEntries.map(e => [e.criterion, slice(withVBind, e.range!)]),
            [
                ['4.1.2', '<input type="text" v-bind="obj" />'],
                ['1.3.1', '<input type="text" v-bind="obj" />'],
                ['1.1.1', '<img v-bind="props" src="a.png" />'],
                ['2.1.1', '<div v-bind="props" @click="open">'],
                ['4.1.2', '<div v-bind="props" @click="open">'],
                ['4.1.2', '<iframe v-bind="props" src="/a">']
            ]
        );
        assert.ok(openEntries.every(e => e.ruleId === undefined), 'Open element Needs Review entries must not be tagged as Unproven rule matches');

        const plainAll = await analyseEveryRule({ languageId: 'vue', text: withoutVBind });
        assert.deepStrictEqual(
            plainAll.findings.map(f => [f.ruleId, slice(withoutVBind, f.range)]),
            [
                ['vuejs-accessibility/form-control-has-label', '<input type="text" />'],
                ['vuejs-accessibility/form-control-has-label', '<input type="text" :placeholder="hint" />'],
                ['vuejs-accessibility/alt-text', '<img src="a.png" />'],
                ['vuejs-accessibility/iframe-has-title', '<iframe src="/a">']
            ]
        );

        const plainProven = await analyse({ languageId: 'vue', text: withoutVBind });
        assert.deepStrictEqual(
            plainProven.findings.map(f => [f.ruleId, slice(withoutVBind, f.range)]),
            [
                ['vuejs-accessibility/alt-text', '<img src="a.png" />'],
                ['vuejs-accessibility/iframe-has-title', '<iframe src="/a">']
            ]
        );
    });

    it('keeps Findings for unaffected rules on an element with object v-bind and for non-open children in Vue', async () => {
        const text = [
            '<template>',
            '    <div role="bogus" v-bind="props">x</div>',
            '    <div v-bind="props"><img src="nested.png" /></div>',
            '</template>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'vue', text });
        assert.deepStrictEqual(
            findings.map(f => [f.ruleId, slice(text, f.range)]),
            [
                ['vuejs-accessibility/aria-role', 'role="bogus"'],
                ['vuejs-accessibility/alt-text', '<img src="nested.png" />']
            ]
        );
    });
});
