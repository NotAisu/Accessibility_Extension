import * as assert from 'assert';
import { analyse, type AnalysisResult } from '../../src/core/analysis';

// Static contrast (#33) through the analysis core, as every language reports it

const page = (body: string, head = '') => [
    '<!DOCTYPE html>',
    `<html lang="en"><head><title>t</title>${head}</head><body><main>`,
    body,
    '</main></body></html>'
].join('\n');

const CONTRAST_RULES = ['allyproof/text-contrast', 'allyproof/non-text-contrast'];

function contrastFindings(result: AnalysisResult, text: string): [string, string][] {
    return result.findings.filter(f => CONTRAST_RULES.includes(f.ruleId)).map(f => [f.ruleId, text.slice(f.range.start, f.range.end)]);
}

function contrastReasons(result: AnalysisResult, criterion = '1.4.3'): string[] {
    return result.needsReview.filter(entry => entry.criterion === criterion && !entry.range).map(entry => entry.reason);
}

describe('static contrast: certain failures', () => {
    it('reports text below 4.5:1 on the browser\'s white background, with the ratio and the required value', async () => {
        const text = page('<p style="color:#777">Muted text</p>');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), [['allyproof/text-contrast', '<p style="color:#777">']]);
        const [finding] = result.findings;
        assert.deepStrictEqual(finding.criteria, ['1.4.3']);
        assert.strictEqual(finding.message, 'Text contrast is 4.47:1, below the required 4.5:1');
        assert.match(finding.explanation, /#777777 on the background #ffffff/);
        assert.match(finding.helpUrl, /contrast-minimum/);
    });

    it('takes the background from a static ancestor', async () => {
        const text = page('<div style="background-color:#000"><p style="color:#333">Dark on black</p></div>');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), [['allyproof/text-contrast', '<p style="color:#333">']]);
    });

    it('reports a text field whose border and background do not stand out from the page', async () => {
        const text = page('<label>Name <input style="border:1px solid #ddd"></label>');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), [['allyproof/non-text-contrast', '<input style="border:1px solid #ddd">']]);
        const finding = result.findings.find(f => f.ruleId === 'allyproof/non-text-contrast')!;
        assert.deepStrictEqual(finding.criteria, ['1.4.11']);
        assert.match(finding.message, /below the required 3:1/);
    });

    it('reads Tailwind palette classes in JSX', async () => {
        const text = 'export const Hint = () => <p className="text-gray-300 bg-white">Optional</p>;\n';

        const result = await analyse({ languageId: 'javascriptreact', text });

        assert.deepStrictEqual(contrastFindings(result, text), [['allyproof/text-contrast', '<p className="text-gray-300 bg-white">']]);
    });

    it('reads a JSX style object of literals', async () => {
        const text = 'export const Hint = () => <p style={{ color: \'#999\', backgroundColor: \'white\' }}>Optional</p>;\n';

        const result = await analyse({ languageId: 'typescriptreact', text });

        assert.deepStrictEqual(contrastFindings(result, text), [['allyproof/text-contrast', '<p style={{ color: \'#999\', backgroundColor: \'white\' }}>']]);
    });

    it('reads Tailwind arbitrary values in Vue', async () => {
        const text = '<template>\n    <p class="text-[#aaa] bg-[#fff]">Optional</p>\n</template>\n';

        const result = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(contrastFindings(result, text), [['allyproof/text-contrast', '<p class="text-[#aaa] bg-[#fff]">']]);
    });

    it('reads inline styles in Svelte, Astro and Angular', async () => {
        for (const languageId of ['svelte', 'astro', 'angular']) {
            const text = '<div style="background: white">\n    <p style="color: #999">Optional</p>\n</div>\n';

            const result = await analyse({ languageId, text });

            // Some engines locate only the start of the tag
            const findings = contrastFindings(result, text);
            assert.strictEqual(findings.length, 1, languageId);
            assert.ok(findings[0][0] === 'allyproof/text-contrast' && '<p style="color: #999">'.startsWith(findings[0][1]), languageId);
            assert.strictEqual(text.indexOf('<p'), result.findings.find(f => f.ruleId === 'allyproof/text-contrast')!.range.start, languageId);
        }
    });
});

describe('static contrast: certain passes', () => {
    it('passes text at 4.5:1 and decides the page\'s text contrast', async () => {
        const text = page('<p style="color:#767676">Body text</p>\n<p>Default black</p>');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), []);
        assert.deepStrictEqual(contrastReasons(result), []);
    });

    it('passes large text at 3:1 by the browser\'s heading size', async () => {
        const text = page('<h1 style="color:#949494">Title</h1>');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), []);
    });

    it('passes a text field whose border stands out', async () => {
        const text = page('<label>Name <input style="border:1px solid #767676"></label>');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), []);
    });

    it('judges the base state only, not hover or dark variants', async () => {
        const text = 'export const Link = () => <p className="text-gray-900 bg-white hover:text-gray-300 dark:bg-gray-900">Docs</p>;\n';

        const result = await analyse({ languageId: 'javascriptreact', text });

        assert.deepStrictEqual(contrastFindings(result, text), []);
    });
});

describe('static contrast: uncertain colors stay Needs Review with the reason', () => {
    const cases: [string, string, string, RegExp][] = [
        ['a CSS variable', 'html', page('<p style="color:var(--muted)">Muted</p>'), /CSS variable/],
        ['a gradient', 'html', page('<p style="color:#777;background:linear-gradient(#fff,#000)">On a gradient</p>'), /image or gradient/],
        ['a background image', 'html', page('<p style="color:#777;background-image:url(bg.png)">On a photo</p>'), /image or gradient/],
        ['opacity', 'html', page('<p style="color:#000;opacity:0.4">Faded</p>'), /opacity 0\.4/],
        ['a semi-transparent color', 'html', page('<p style="color:rgba(0,0,0,0.4)">Faded</p>'), /semi-transparent/],
        ['a text shadow', 'html', page('<p style="color:#eee;text-shadow:0 0 2px #000">Shadowed</p>'), /text-shadow/],
        ['a Tailwind opacity modifier', 'javascriptreact', 'export const A = () => <p className="text-black/40 bg-white">Faded</p>;\n', /semi-transparent/],
        ['a bound class', 'javascriptreact', 'export const A = ({ tone }) => <div className="bg-white"><p className={tone}>Toned</p></div>;\n', /binds its class or style/],
        ['a bound class in Vue', 'vue', '<template>\n    <div class="bg-white"><p :class="tone">Toned</p></div>\n</template>\n', /binds its class or style/],
        ['a component in between', 'javascriptreact', 'export const A = () => <div className="bg-black"><Card><p className="text-gray-800">Inside</p></Card></div>;\n', /component <Card>/],
        ['an unknown font size', 'javascriptreact', 'export const A = () => <p style={{ color: \'#949494\', background: \'#fff\' }}>Maybe large</p>;\n', /passes only as large text/],
        ['the browser\'s button colors', 'vue', '<template>\n    <div style="color: #777"><button>Save</button></div>\n</template>\n', /browser's own text color of <button>/],
        ['a class on an ancestor that is not a Tailwind utility', 'javascriptreact', 'export const A = () => <div className="card-dark" style={{ background: \'#000\' }}><p className="text-gray-800">Inside</p></div>;\n', /class card-dark may set colors/],
        ['a class on the text that is not a Tailwind utility', 'vue', '<template>\n    <p class="note text-gray-400 bg-white">Note</p>\n</template>\n', /class note may set colors/],
        ['a Vue <style> block that sets colors', 'vue', '<template>\n    <p style="color: #777; background: #fff">Note</p>\n</template>\n<style scoped>\np { color: black; }\n</style>\n', /<style> block or component styles in this file set colors/],
        ['a Svelte <style> block that sets colors', 'svelte', '<p style="color: #777; background: #fff">Note</p>\n<style>\n    p { background-color: black; }\n</style>\n', /<style> block or component styles in this file set colors/],
        ['an Astro <style> block that sets colors', 'astro', '---\n---\n<p style="color: #777; background: #fff">Note</p>\n<style>p { color: #000; }</style>\n', /<style> block or component styles in this file set colors/],
        ['Angular component styles that set colors', 'typescript', [
            'import { Component } from \'@angular/core\';',
            '@Component({',
            '    selector: \'app-note\',',
            '    template: `<p style="color: #777; background: #fff">Note</p>`,',
            '    styles: [`p { color: black; }`]',
            '})',
            'export class NoteComponent {}',
            ''
        ].join('\n'), /<style> block or component styles in this file set colors/]
    ];

    for (const [name, languageId, text, reason] of cases) {
        it(`names ${name} and reports no Finding`, async () => {
            const result = await analyse({ languageId, text });

            assert.deepStrictEqual(contrastFindings(result, text), []);
            const reasons = contrastReasons(result);
            assert.ok(reasons.some(r => reason.test(r)), `no reason matching ${reason} in ${JSON.stringify(reasons)}`);
        });
    }

    it('counts the elements that share a reason in one entry', async () => {
        const text = page('<p style="color:var(--a)">One</p>\n<p style="color:var(--a)">Two</p>');

        const result = await analyse({ languageId: 'html', text });

        assert.ok(contrastReasons(result).includes('2 elements: text contrast is uncertain: the color var(--a) is a CSS variable.'));
    });

    it('leaves text no file colors to the general entry', async () => {
        const text = 'export const A = ({ label }) => <p className="mt-4">{label}</p>;\n';

        const result = await analyse({ languageId: 'javascriptreact', text });

        assert.deepStrictEqual(contrastReasons(result), ['Text contrast depends on rendered colors.']);
    });

    it('does not take the browser\'s defaults where a stylesheet may change them', async () => {
        const text = page('<p style="color:#777">Muted</p>', '<link rel="stylesheet" href="site.css">');

        const result = await analyse({ languageId: 'html', text });

        assert.deepStrictEqual(contrastFindings(result, text), []);
        assert.ok(contrastReasons(result).some(r => /background color is not set in this file/.test(r)));
    });
});

describe('static contrast: classes and style blocks that cannot set colors', () => {
    const failing: [string, string, string][] = [
        ['Tailwind utilities that set no colors', 'javascriptreact', 'export const A = () => <p className="p-4 mt-2 flex items-center rounded-lg shadow w-full text-gray-300 bg-white">Optional</p>;\n'],
        ['classes in a page with browser styles only', 'html', page('<p class="card-dark" style="color:#777">Muted text</p>')],
        ['a <style> block that sets no colors', 'vue', '<template>\n    <p style="color: #aaa; background: #fff">Note</p>\n</template>\n<style>\np { margin: 0; }\n</style>\n']
    ];

    for (const [name, languageId, text] of failing) {
        it(`still reports the contrast for ${name}`, async () => {
            const result = await analyse({ languageId, text });

            assert.deepStrictEqual(contrastFindings(result, text).map(([rule]) => rule), ['allyproof/text-contrast']);
        });
    }
});

describe('static contrast: no false positives', () => {
    const passing: [string, string, string][] = [
        ['hidden text', 'html', page('<p style="color:#eee;display:none">Hidden</p>\n<p class="x" hidden style="color:#eee">Hidden</p>')],
        ['visually hidden text', 'javascriptreact', 'export const A = () => <span className="sr-only text-gray-200">Skip</span>;\n'],
        ['aria-hidden text', 'html', page('<div aria-hidden="true"><p style="color:#eee">Decoration</p></div>')],
        ['a disabled control', 'html', page('<button disabled style="color:#ccc;background:#fff">Save</button>')],
        ['the label of a disabled field', 'html', page('<label for="n" style="color:#ccc">Name</label><input id="n" disabled>')],
        ['text without letters', 'html', page('<p style="color:#eee">·</p>')],
        ['text in the same color as its background', 'html', page('<p style="color:#fff">Spam keywords</p>')],
        ['script and template text', 'html', page('<template><p style="color:#eee">Later</p></template>')],
        ['colors set only in a variant', 'vue', '<template>\n    <p class="hover:text-gray-200 dark:bg-white">Docs</p>\n</template>\n'],
        ['large bold text at 3:1', 'html', page('<p style="color:#949494;font-size:14pt;font-weight:bold">Bold</p>')],
        ['a text field without a border', 'html', page('<input style="background:#fafafa">')],
        ['a Svelte expression with a bound style', 'svelte', '<p style="color: {tone}; background: white">{label}</p>\n'],
        ['an Angular bound style', 'angular', '<div style="background: white"><p [style.color]="tone">Toned</p></div>\n'],
        ['an Astro page with its own stylesheet', 'astro', '---\n---\n<p>Plain</p>\n<style>p { color: #eee; }</style>\n']
    ];

    for (const [name, languageId, text] of passing) {
        it(`reports nothing for ${name}`, async () => {
            const result = await analyse({ languageId, text });

            assert.deepStrictEqual(contrastFindings(result, text), []);
        });
    }
});
