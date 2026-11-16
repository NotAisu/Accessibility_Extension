import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyse, type AnalysisOptions, type Finding } from '../../src/core/analysis';

// Component Mapping: a mapped component gets the Findings of the native element it renders, an unmapped one none

const components: AnalysisOptions['components'] = {
    components: { Image: 'img', 'UI.Image': 'img', AppImage: 'img', 'app-image': 'img', Field: 'input', 'app-field': 'input', Link: 'a' },
    polymorphicPropName: 'as'
};

// The rule and criteria of each Finding, which is what a mapped component must share with its native element;
// ranges differ with the length of the name
const kinds = (findings: Finding[]) => findings.map(f => `${f.ruleId} ${f.criteria.join(',')}`).sort();

interface Case {
    name: string;
    languageId: string;
    native: string;
    component: string;
    /** The start of the component's Findings. */
    at: string;
}

const jsx = (markup: string) => `export const View = () => <main>${markup}</main>;\n`;
const vue = (markup: string) => `<template>\n  <main>${markup}</main>\n</template>\n`;
const astro = (markup: string) => `---\n---\n<main>${markup}</main>\n`;
const inline = (markup: string) => `import { Component } from '@angular/core';\n\n@Component({ selector: 'app-view', template: '<main>${markup}</main>' })\nexport class View {}\n`;

const cases: Case[] = [
    { name: 'a JSX component without alt', languageId: 'javascriptreact', native: jsx('<img src="a.png" />'), component: jsx('<Image src="a.png" />'), at: '<Image' },
    { name: 'a TSX component from a namespace', languageId: 'typescriptreact', native: jsx('<img src="a.png" />'), component: jsx('<UI.Image src="a.png" />'), at: '<UI.Image' },
    { name: 'a JSX password field component (own rule)', languageId: 'javascriptreact', native: jsx('<input type="password" autoComplete="off" />'), component: jsx('<Field type="password" autoComplete="off" />'), at: '<Field' },
    { name: 'a JSX component with a polymorphic prop', languageId: 'javascriptreact', native: jsx('<a>Home</a>'), component: jsx('<Box as="a">Home</Box>'), at: '<Box' },
    { name: 'a Vue component in PascalCase', languageId: 'vue', native: vue('<img src="a.png">'), component: vue('<AppImage src="a.png" />'), at: '<AppImage' },
    { name: 'a Vue component in kebab-case', languageId: 'vue', native: vue('<img src="a.png">'), component: vue('<app-image src="a.png" />'), at: '<app-image' },
    { name: 'a Vue password field component (own rule)', languageId: 'vue', native: vue('<input type="password" autocomplete="off">'), component: vue('<Field type="password" autocomplete="off" />'), at: '<Field' },
    { name: 'an Angular template component', languageId: 'angular', native: '<img src="a.png">\n', component: '<app-image src="a.png"></app-image>\n', at: '<app-image' },
    { name: 'an Angular password field component (own rule)', languageId: 'angular', native: '<input type="password" autocomplete="off">\n', component: '<app-field type="password" autocomplete="off"></app-field>\n', at: '<app-field' },
    { name: 'a component in an inline Angular template', languageId: 'typescript', native: inline('<img src="a.png">'), component: inline('<app-image src="a.png"></app-image>'), at: '<app-image' },
    { name: 'an Astro component', languageId: 'astro', native: astro('<img src="a.png" />'), component: astro('<Image src="a.png" />'), at: '<Image' },
    { name: 'a Svelte password field component (own rule)', languageId: 'svelte', native: '<input type="password" autocomplete="off" />\n', component: '<script>\n  import Field from "./Field.svelte";\n</script>\n\n<Field type="password" autocomplete="off" />\n', at: '<Field' }
];

describe('component mapping', () => {
    for (const { name, languageId, native, component, at } of cases) {
        it(`reports ${name} as the native element it is mapped to, and nothing unmapped`, async () => {
            const expected = await analyse({ languageId, text: native });
            const mapped = await analyse({ languageId, text: component }, { components });
            const unmapped = await analyse({ languageId, text: component });

            assert.notDeepStrictEqual(kinds(expected.findings), [], 'the native element has Findings');
            assert.deepStrictEqual(kinds(mapped.findings), kinds(expected.findings));
            assert.ok(mapped.findings.every(f => f.range.start === component.indexOf(at)), 'Findings point at the component');
            assert.deepStrictEqual(kinds(unmapped.findings), []);
        });
    }

    it('keeps a lowercase native element apart from a component of the same name in a template', async () => {
        const text = vue('<link rel="stylesheet" href="a.css"><Link>Home</Link>');
        const { findings } = await analyse({ languageId: 'vue', text }, { components: { components: { Link: 'a' } } });
        assert.deepStrictEqual(kinds(findings), kinds((await analyse({ languageId: 'vue', text: vue('<a>Home</a>') })).findings));
    });

    it('lists a mapped control for target size review, and leaves the colors of a mapped component unknown', async () => {
        const text = jsx('<Field type="text" className="h-4 text-gray-400 bg-white" />');
        const { needsReview, findings } = await analyse({ languageId: 'javascriptreact', text }, { components });

        assert.ok(needsReview.some(entry => entry.criterion === '2.5.8' && entry.range?.start === text.indexOf('<Field')));
        assert.deepStrictEqual(findings.filter(f => f.criteria.includes('1.4.3') || f.criteria.includes('1.4.11')), []);
    });

    it('reads the mapping per resource from the settings only', () => {
        const root = path.join(__dirname, '..', '..');
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
            contributes: { configuration: { properties: Record<string, { scope?: string; type: string }> } };
        };
        const { properties } = manifest.contributes.configuration;
        assert.deepStrictEqual([properties['allyproof.components'], properties['allyproof.polymorphicPropName']].map(p => [p.type, p.scope]),
            [['object', 'resource'], ['string', 'resource']]);
        const source = fs.readFileSync(path.join(root, 'src', 'check-diagnostics.ts'), 'utf8');
        assert.match(source, /getConfiguration\('allyproof', scope\)\.get<Record<string, string>>\('components'/);
        assert.match(source, /getConfiguration\('allyproof', scope\)\.get<string>\('polymorphicPropName'/);
        // Nothing in the core reads a file or loads a module by a name from the mapping
        const core = fs.readFileSync(path.join(root, 'src', 'core', 'components.ts'), 'utf8');
        assert.doesNotMatch(core, /\b(import|require)\(|from '|readFile/);
    });
});
