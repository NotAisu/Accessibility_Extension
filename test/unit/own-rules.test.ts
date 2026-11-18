import * as assert from 'assert';
import { analyse } from './every-rule';

const page = (body: string) => [
    '<!DOCTYPE html>',
    '<html lang="en"><head><title>t</title></head><body><main>',
    body,
    '</main></body></html>'
].join('\n');

const slice = (text: string, range: { start: number; end: number }) => text.slice(range.start, range.end);

describe('own rules', () => {
    it('reports a password field that keeps password managers out (3.3.8)', async () => {
        const text = page([
            '<label>Password <input type="password" autocomplete="off"></label>',
            '<label>New <input type="password" autocomplete="new-password"></label>',
            '<label>Old <input type="password"></label>',
            '<label>Code <input type="PASSWORD" autocomplete=" Off "></label>'
        ].join('\n'));

        const { findings } = await analyse({ languageId: 'html', text });

        const own = findings.filter(f => f.ruleId === 'allyproof/password-autocomplete');
        assert.deepStrictEqual(own.map(f => slice(text, f.range)), [
            '<input type="password" autocomplete="off">',
            '<input type="PASSWORD" autocomplete=" Off ">'
        ]);
        assert.deepStrictEqual(own[0].criteria, ['3.3.8']);
        assert.strictEqual(own[0].layer, 'check');
        assert.match(own[0].helpUrl, /accessible-authentication-minimum$/);
    });

    it('reports it in every language, from the start tag as written', async () => {
        const documents = [
            { languageId: 'javascriptreact', text: 'export const Login = () => <input type="password" autoComplete="off" />;\n', tag: '<input type="password" autoComplete="off" />' },
            { languageId: 'typescriptreact', text: 'export const Login = (): JSX.Element => <input type="password" autoComplete="off" />;\n', tag: '<input type="password" autoComplete="off" />' },
            { languageId: 'vue', text: '<template>\n  <input type="password" autocomplete="off">\n</template>\n', tag: '<input type="password" autocomplete="off">' },
            { languageId: 'svelte', text: '<input type="password" autocomplete="off" />\n', tag: '<input' },
            { languageId: 'astro', text: '---\n---\n<input type="password" autocomplete="off" />\n', tag: '<input type="password" autocomplete="off" />' },
            { languageId: 'angular', text: '<input type="password" autocomplete="off">\n', tag: '<input type="password" autocomplete="off">' },
            {
                languageId: 'typescript',
                text: "@Component({ selector: 'app-login', template: '<input type=\"password\" autocomplete=\"off\">' })\nexport class Login {}\n",
                tag: '<input type=\"password\" autocomplete=\"off\">'
            }
        ];
        for (const { languageId, text, tag } of documents) {
            const { findings } = await analyse({ languageId, text });

            const own = findings.filter(f => f.ruleId === 'allyproof/password-autocomplete');
            assert.deepStrictEqual(own.map(f => slice(text, f.range)), [tag], languageId);
        }
    });

    it('reports an autocomplete value that is no autofill token sequence where no upstream rule does (1.3.5)', async () => {
        const inputs = [
            '<input autocomplete="emal">',
            '<input autocomplete="section-a shipping work email webauthn">',
            '<input autocomplete=" Given-Name ">',
            '<input autocomplete="off">',
            '<input autocomplete="work name">',
            '<select autocomplete="country"></select>',
            '<input type="hidden" autocomplete="nonsense">',
            '<input type="submit" autocomplete="nonsense">'
        ];
        const documents = [
            { languageId: 'vue', text: `<template>\n${inputs.join('\n')}\n  <input :autocomplete="mode">\n</template>\n` },
            { languageId: 'angular', text: `${inputs.join('\n')}\n<input [autocomplete]="mode">\n` },
            { languageId: 'typescript', text: `@Component({ selector: 'app-form', template: '${inputs[0]}' })\nexport class Form {}\n` }
        ];
        for (const { languageId, text } of documents) {
            const { findings } = await analyse({ languageId, text });

            const own = findings.filter(f => f.ruleId === 'allyproof/autocomplete-valid');
            assert.deepStrictEqual(own.map(f => slice(text, f.range)), languageId === 'typescript'
                ? ['<input autocomplete="emal">']
                : ['<input autocomplete="emal">', '<input autocomplete="work name">'], languageId);
            assert.deepStrictEqual(own[0].criteria, ['1.3.5']);
        }

        // Upstream engines check 1.3.5 in the other languages, so the own rule stays out
        const { findings } = await analyse({ languageId: 'html', text: page('<label>Mail <input autocomplete="emal"></label>') });
        assert.deepStrictEqual(findings.filter(f => f.ruleId === 'allyproof/autocomplete-valid'), []);
    });

    it('never guesses a bound value', async () => {
        const text = '<template>\n  <input type="password" :autocomplete="mode">\n  <input :type="kind" autocomplete="off">\n</template>\n';

        const { findings } = await analyse({ languageId: 'vue', text });

        assert.deepStrictEqual(findings.filter(f => f.ruleId.startsWith('allyproof/')), []);
    });

    it('lists a control declaring a size below 24x24 CSS px as a likely failure at the element (2.5.8)', async () => {
        const text = page([
            '<button style="width: 16px; height: 16px">x</button>',
            '<a href="/next" class="hover:w-8 w-5 h-5">Next</a>',
            '<button class="size-6">ok</button>',
            '<button style="width:1rem;min-width:24px;height:30px">ok</button>',
            '<button class="w-[20px]">x</button>',
            '<div class="w-4 h-4">not a control</div>'
        ].join('\n'));

        const { needsReview } = await analyse({ languageId: 'html', text });

        const located = needsReview.filter(entry => entry.range);
        assert.deepStrictEqual(located.map(entry => [entry.criterion, slice(text, entry.range!)]), [
            ['2.5.8', '<button style="width: 16px; height: 16px">'],
            ['2.5.8', '<a href="/next" class="hover:w-8 w-5 h-5">'],
            ['2.5.8', '<button class="w-[20px]">']
        ]);
        assert.match(located[0].reason, /likely failure/i);
        assert.match(located[0].reason, /16×16 CSS px/);
        assert.match(located[2].reason, /width of 20 CSS px/);
        // The criterion stays listed for what layout decides
        assert.ok(needsReview.some(entry => entry.criterion === '2.5.8' && !entry.range));
    });

    it('reads Tailwind classes and literal style objects in JSX and never guesses a style expression', async () => {
        const text = 'export const Close = ({ size }) => (\n    <>\n        <button className="w-4 h-4">x</button>\n        <button style={{ width: 16, height: 16 }}>x</button>\n        <button style={{ width: size, height: size }}>x</button>\n    </>\n);\n';

        const { needsReview } = await analyse({ languageId: 'javascriptreact', text });

        assert.deepStrictEqual(needsReview.filter(entry => entry.range).map(entry => slice(text, entry.range!)), [
            '<button className="w-4 h-4">',
            '<button style={{ width: 16, height: 16 }}>'
        ]);
    });
});
