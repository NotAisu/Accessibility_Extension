import * as assert from 'assert';
import { analyse, checkLanguageId, isChecked, ParseError } from '../../src/core/analysis';

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

    it('lists contrast and target size as Needs Review for rendered text and controls', async () => {
        const text = '<template>\n    <form>\n        <p>{{ label }}</p>\n        <button type="submit">Save</button>\n    </form>\n</template>\n';

        const { needsReview } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(needsReview.map(entry => entry.criterion), ['1.4.3', '2.5.8']);
    });

    it('lists no Needs Review when the template renders no text or control', async () => {
        const text = '<script setup>\nconst label = "Save";\n</script>\n<template>\n    <img src="logo.png" alt="">\n    <div class="gap" title="Gap"></div>\n</template>\n';

        const { needsReview } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(needsReview, []);
    });

    it('fails on an unparseable script instead of reporting no Findings', async () => {
        await assert.rejects(analyse({ languageId: 'vue', text: '<script>const a = ;</script>\n<template><img src="x"></template>' }), ParseError);
    });
});

describe('analyse (Svelte)', () => {
    it('reports a Svelte compiler a11y warning as a Check Finding at the exact source range', async () => {
        const text = '<script>\n    let { src } = $props();\n</script>\n\n<img {src}>\n';

        const { findings } = await analyse({ languageId: 'svelte', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), '<img {src}>');
        assert.deepStrictEqual(finding.criteria, ['1.1.1']);
        assert.strictEqual(finding.ruleId, 'svelte/a11y_missing_attribute');
        assert.strictEqual(finding.layer, 'check');
        assert.strictEqual(finding.severity, 'warning');
        assert.strictEqual(finding.message, '`<img>` element should have an alt attribute');
        assert.strictEqual(finding.helpUrl, 'https://svelte.dev/e/a11y_missing_attribute');
    });

    it('lists contrast and target size as Needs Review for rendered text and controls', async () => {
        const text = '<script>\n    let { label } = $props();\n</script>\n\n{#if label}\n    <p>{label}</p>\n{/if}\n<a href="/home">Home</a>\n';

        const { needsReview } = await analyse({ languageId: 'svelte', text });

        assert.deepStrictEqual(needsReview.map(entry => entry.criterion), ['1.4.3', '2.5.8']);
    });

    it('lists no Needs Review when the markup renders no text or control', async () => {
        const text = '<script>\n    const label = "Save";\n</script>\n\n<img src="logo.png" alt="">\n<div class="gap" title="Gap"></div>\n\n<style>\n    .gap { width: 1rem; }\n</style>\n';

        const { needsReview } = await analyse({ languageId: 'svelte', text });

        assert.deepStrictEqual(needsReview, []);
    });

    it('fails on unparseable code instead of reporting no Findings', async () => {
        await assert.rejects(analyse({ languageId: 'svelte', text: '<div><img src="x">{#if a}</div>' }), ParseError);
    });

    it('maps each warning to its WCAG criterion, by element where one warning covers several', async () => {
        const text = [
            '<html><body></body></html>',
            '<iframe src="/map"></iframe>',
            '<a href="/home"></a>',
            '<h2></h2>',
            '<div onclick={open}>Open</div>',
            '<input type="email" autocomplete="emial">',
            '<span tabindex="2">x</span>',
            '<button accesskey="s">Save</button>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'svelte', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.criteria]), [
            ['svelte/a11y_missing_attribute', ['3.1.1']],
            ['svelte/a11y_missing_attribute', ['4.1.2']],
            ['svelte/a11y_consider_explicit_label', ['2.4.4', '4.1.2']],
            ['svelte/a11y_missing_content', ['2.4.6', '1.3.1']],
            ['svelte/a11y_click_events_have_key_events', ['2.1.1']],
            ['svelte/a11y_no_static_element_interactions', ['4.1.2']],
            ['svelte/a11y_autocomplete_valid', ['1.3.5']],
            ['svelte/a11y_positive_tabindex', ['2.4.3']]
        ]);
    });
});


describe('analyse (Astro)', () => {
    it('reports a Check Finding at the exact source range of the template element', async () => {
        const text = '---\nconst chart = "/chart.png";\n---\n\n<img src={chart}>\n';

        const { findings } = await analyse({ languageId: 'astro', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), '<img src={chart}>');
        assert.deepStrictEqual(finding.criteria, ['1.1.1']);
        assert.strictEqual(finding.ruleId, 'astro/jsx-a11y/alt-text');
        assert.strictEqual(finding.layer, 'check');
        assert.strictEqual(finding.severity, 'warning');
        assert.match(finding.message, /alt prop/);
        assert.strictEqual(finding.helpUrl, 'https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/tree/HEAD/docs/rules/alt-text.md');
    });

    it('parses TypeScript frontmatter', async () => {
        const text = [
            '---',
            'interface Props { src: string }',
            'const { src } = Astro.props as Props;',
            'const label = (n: number): string => `#${n}`;',
            '---',
            '<img src={src as string}>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'astro', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, text.slice(f.range.start, f.range.end)]), [
            ['astro/jsx-a11y/alt-text', '<img src={src as string}>']
        ]);
    });

    it('maps each rule to its WCAG criterion, reading expressions and Astro attributes', async () => {
        const text = [
            '---',
            'const items = ["a", "b"];',
            '---',
            '<html>',
            '    <main>',
            '        {items.map(item => <a href={item}></a>)}',
            '        <div onclick="open()">Open</div>',
            '        <span tabindex={2}>x</span>',
            '        <label>Name</label>',
            '        <h2 class="title"></h2>',
            '        <img alt={item} src="x.png">',
            '    </main>',
            '</html>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'astro', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.criteria]), [
            ['astro/jsx-a11y/html-has-lang', ['3.1.1']],
            ['astro/jsx-a11y/anchor-has-content', ['2.4.4', '4.1.2']],
            ['astro/jsx-a11y/click-events-have-key-events', ['2.1.1']],
            ['astro/jsx-a11y/no-static-element-interactions', ['4.1.2']],
            ['astro/jsx-a11y/tabindex-no-positive', ['2.4.3']],
            ['astro/jsx-a11y/label-has-associated-control', ['1.3.1', '4.1.2']],
            ['astro/jsx-a11y/heading-has-content', ['2.4.6', '1.3.1']]
        ]);
    });

    it('fails on unparseable frontmatter instead of reporting no Findings', async () => {
        await assert.rejects(analyse({ languageId: 'astro', text: '---\nconst a = ;\n---\n<img src="x">' }), ParseError);
    });

    it('lists contrast and target size as Needs Review for rendered text and controls', async () => {
        const text = '---\nconst label = "Save";\n---\n<form>\n    <p>{label}</p>\n    <button type="submit">Save</button>\n</form>\n';

        const { needsReview } = await analyse({ languageId: 'astro', text });

        assert.deepStrictEqual(needsReview.map(entry => entry.criterion), ['1.4.3', '2.5.8']);
    });

    it('lists no Needs Review when the template renders no text or control', async () => {
        const text = [
            '---',
            'const label = "Save";',
            '---',
            '<img src="logo.png" alt="" />',
            '<div class="gap" title={label}></div>',
            '<script>const hint = "not rendered";</script>',
            '<style>.gap { width: 1rem; }</style>'
        ].join('\n');

        const { needsReview } = await analyse({ languageId: 'astro', text });

        assert.deepStrictEqual(needsReview, []);
    });
});


describe('analyse (Angular)', () => {
    it('reports a Check Finding at the exact source range of the external template element', async () => {
        const text = '<section>\n    @if (chart) {\n        <img [src]="chart">\n    }\n</section>\n';

        const { findings } = await analyse({ languageId: 'angular', text });

        assert.strictEqual(findings.length, 1);
        const [finding] = findings;
        assert.strictEqual(text.slice(finding.range.start, finding.range.end), '<img [src]="chart">');
        assert.deepStrictEqual(finding.criteria, ['1.1.1']);
        assert.strictEqual(finding.ruleId, '@angular-eslint/template/alt-text');
        assert.strictEqual(finding.layer, 'check');
        assert.strictEqual(finding.severity, 'warning');
        assert.match(finding.message, /text alternative/);
        assert.strictEqual(finding.helpUrl, 'https://github.com/angular-eslint/angular-eslint/blob/main/packages/eslint-plugin-template/docs/rules/alt-text.md');
    });

    it('maps Findings in inline templates back to the component file', async () => {
        const text = [
            "import { Component } from '@angular/core';",
            '',
            "@Component({ selector: 'app-logo', template: '<img src=\"logo.png\">' })",
            'export class LogoComponent {}',
            '',
            '@Component({',
            "    selector: 'app-nav',",
            '    template: `',
            '        <a href="/home"></a>',
            '        <span (click)="open()">Open</span>',
            '    `',
            '})',
            'export class NavComponent {}'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'typescript', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId, f.criteria, text.slice(f.range.start, f.range.end)]), [
            ['@angular-eslint/template/alt-text', ['1.1.1'], '<img src="logo.png">'],
            ['@angular-eslint/template/elements-content', ['2.4.4', '4.1.2'], '<a href="/home"></a>'],
            ['@angular-eslint/template/click-events-have-key-events', ['2.1.1'], '<span (click)="open()">Open</span>'],
            ['@angular-eslint/template/interactive-supports-focus', ['2.1.1'], '<span (click)="open()">Open</span>']
        ]);
    });

    it('checks no TypeScript file without a component and no component with a templateUrl', async () => {
        const plain = "const template = '<img src=\"x\">';\nexport class Logo {}\n";
        const external = "@Component({ templateUrl: './logo.component.html' })\nexport class LogoComponent {}\n";

        assert.deepStrictEqual(await analyse({ languageId: 'typescript', text: plain }), { findings: [], needsReview: [] });
        assert.deepStrictEqual(await analyse({ languageId: 'typescript', text: external }), { findings: [], needsReview: [] });
    });

    it('maps each rule to its WCAG criterion, reading bindings and control flow', async () => {
        const text = [
            '<main>',
            '    <h2></h2>',
            '    <button></button>',
            '    <span tabindex="2" (mouseover)="show()">x</span>',
            '    <marquee>News</marquee>',
            '    <div [attr.aria-checked]="on" role="checkbox"></div>',
            '    @for (row of rows; track row.id) {',
            '        <td scope="row">{{ row.name }}</td>',
            '    }',
            '    <label>Name</label>',
            '    <input [aria-foo]="x">',
            '</main>'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'angular', text });

        assert.deepStrictEqual(findings.map(f => [f.ruleId.replace('@angular-eslint/template/', ''), f.criteria]), [
            ['elements-content', ['2.4.6', '1.3.1']],
            ['elements-content', ['4.1.2']],
            ['mouse-events-have-key-events', ['2.1.1']],
            ['no-positive-tabindex', ['2.4.3']],
            ['no-distracting-elements', ['2.2.2']],
            ['table-scope', ['1.3.1']],
            ['label-has-associated-control', ['1.3.1', '4.1.2']],
            ['valid-aria', ['4.1.2']]
        ]);
    });

    it('lists contrast and target size as Needs Review for rendered text and controls', async () => {
        const text = '@if (user) {\n    <p>{{ user.name }}</p>\n    <a [href]="user.url"><img src="me.png" alt="Profile"></a>\n}\n';

        const { needsReview } = await analyse({ languageId: 'angular', text });

        assert.deepStrictEqual(needsReview.map(entry => entry.criterion), ['1.4.3', '2.5.8']);
    });

    it('lists no Needs Review when the template renders no text or control', async () => {
        const text = '<img src="logo.png" alt="">\n<div class="gap" title="Gap"></div>\n';

        const { needsReview } = await analyse({ languageId: 'angular', text });

        assert.deepStrictEqual(needsReview, []);
    });

    it('fails on an unparseable template instead of reporting no Findings', async () => {
        await assert.rejects(analyse({ languageId: 'angular', text: '<div><img src="x"></span>' }), ParseError);
        const component = "@Component({ template: '<div><img src=\"x\"></span>' })\nexport class A {}\n";
        await assert.rejects(analyse({ languageId: 'typescript', text: component }), ParseError);
    });

    it('fails on an unparseable component file instead of reporting no Findings', async () => {
        const component = "@Component({\n    selector: 'app-a',\n    <!-- a comment outside the template -->\n    template: '<img src=\"x\">'\n})\nexport class A {}\n";

        await assert.rejects(analyse({ languageId: 'typescript', text: component }), ParseError);
    });

    it('checks HTML files named *.component.html as Angular templates', () => {
        assert.strictEqual(checkLanguageId('html', '/app/src/nav/nav.component.html'), 'angular');
        assert.strictEqual(checkLanguageId('html', 'C:\\app\\Nav.Component.HTML'), 'angular');
        assert.strictEqual(checkLanguageId('html', '/site/index.html'), 'html');
        assert.strictEqual(checkLanguageId('typescript', '/app/src/nav/nav.component.ts'), 'typescript');
    });

    it('checks TypeScript files only while they hold an Angular component', () => {
        assert.strictEqual(isChecked({ languageId: 'typescript', text: "@Component({ template: '<p>Hi</p>' })\nexport class A {}" }), true);
        assert.strictEqual(isChecked({ languageId: 'typescript', text: 'export const answer = 42;' }), false);
        assert.strictEqual(isChecked({ languageId: 'html', text: '<p>Hi</p>' }), true);
    });

    it('ignores a Finding in an inline template with a markup comment on the line above', async () => {
        const text = [
            '@Component({',
            '    template: `',
            '        <!-- allyproof-ignore @angular-eslint/template/alt-text -->',
            '        <img src="spacer.png">',
            '        <img src="chart.png">',
            '    `',
            '})',
            'export class ChartComponent {}'
        ].join('\n');

        const { findings } = await analyse({ languageId: 'typescript', text });

        assert.deepStrictEqual(findings.map(f => text.slice(f.range.start, f.range.end)), ['<img src="chart.png">']);
    });
});
