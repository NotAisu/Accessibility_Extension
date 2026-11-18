import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as axe from 'axe-core/axe.min.js';
import { RULE_CRITERIA as JSX_RULES } from '../../src/core/jsx/engine';
import { RULE_CRITERIA as VUE_RULES } from '../../src/core/vue/engine';
import { ELEMENTS_CONTENT_CRITERIA, RULE_CRITERIA as ANGULAR_RULES } from '../../src/core/angular/engine';
import { MISSING_ATTRIBUTE_CRITERIA, WARNING_CRITERIA as SVELTE_WARNINGS } from '../../src/core/svelte/engine';
import { RULE_CRITERIA as HTML_ESLINT_RULES } from '../../src/core/html/html-eslint-check';
import { AXE_TAGS, LAYOUT_RULES } from '../../src/core/html/axe-check';
import { isTargetCriterion } from '../../src/core/wcag';
import { FRAMEWORKS, ruleDoc, type Framework } from '../../src/core/rule-docs';
import { ENTRIES } from '../../src/core/rule-docs-data';
import { analyse } from './every-rule';

const union = (table: Record<string, string[]>) => [...new Set(Object.values(table).flat())];

// The own rules: every `${PREFIX}name` in a core file whose PREFIX is 'allyproof/'
function ownRules(): Record<string, string[]> {
    const core = path.join(__dirname, '..', '..', 'src', 'core');
    const rules: Record<string, string[]> = {};
    for (const file of fs.readdirSync(core).filter(name => name.endsWith('.ts'))) {
        const source = fs.readFileSync(path.join(core, file), 'utf-8');
        if (!source.includes("const PREFIX = 'allyproof/'")) continue;
        for (const [, criteria, rule] of source.matchAll(/criteria: (\[[^\]]*\]),\s*ruleId: `\$\{PREFIX\}([a-z-]+)`/g)) {
            rules[`allyproof/${rule}`] = JSON.parse(criteria.replace(/'/g, '"')) as string[];
        }
    }
    return rules;
}

/** Every rule id an engine can emit, with the criteria its Findings can carry. */
function emittableRules(): Record<string, string[]> {
    const prefixed = (prefix: string, table: Record<string, string[]>) =>
        Object.fromEntries(Object.entries(table).map(([rule, criteria]) => [prefix + rule, criteria]));
    const axeRules = Object.fromEntries(axe.getRules(AXE_TAGS)
        .filter(rule => !LAYOUT_RULES.includes(rule.ruleId))
        .map(rule => [rule.ruleId, rule.tags
            .map(tag => /^wcag(\d)(\d)(\d{1,2})$/.exec(tag))
            .filter((m): m is RegExpExecArray => m !== null)
            .map(([, a, b, c]) => `${a}.${b}.${c}`)
            .filter(isTargetCriterion)] as const)
        .filter(([, criteria]) => criteria.length > 0));
    return {
        ...prefixed('jsx-a11y-x/', JSX_RULES),
        ...prefixed('astro/jsx-a11y/', JSX_RULES),
        ...prefixed('vuejs-accessibility/', VUE_RULES),
        ...prefixed('@angular-eslint/template/', { ...ANGULAR_RULES, 'elements-content': union(ELEMENTS_CONTENT_CRITERIA) }),
        ...prefixed('svelte/', { ...SVELTE_WARNINGS, 'a11y_missing_attribute': union(MISSING_ATTRIBUTE_CRITERIA) }),
        ...prefixed('@html-eslint/', HTML_ESLINT_RULES),
        ...axeRules,
        ...ownRules()
    };
}

describe('rule docs', () => {
    const rules = emittableRules();

    it('finds the rule ids of every engine', () => {
        const ids = Object.keys(rules);
        for (const prefix of ['jsx-a11y-x/', 'astro/jsx-a11y/', 'vuejs-accessibility/', '@angular-eslint/template/', 'svelte/', '@html-eslint/']) {
            assert.ok(ids.some(id => id.startsWith(prefix)), prefix);
        }
        assert.ok(ids.includes('image-alt'));
        assert.ok(ids.includes('allyproof/password-autocomplete'));
        assert.ok(ids.includes('allyproof/autocomplete-valid'));
        assert.ok(!ids.includes('color-contrast'), 'layout rules never run');
    });

    it('has an entry for every rule id an engine can emit', () => {
        const missing = Object.keys(rules).filter(id => !ruleDoc(id));
        assert.deepStrictEqual(missing, []);
    });

    it('has an entry for the static contrast rules', () => {
        assert.ok(ruleDoc('allyproof/text-contrast')?.details);
        assert.ok(ruleDoc('allyproof/non-text-contrast')?.details);
    });

    it('fills every field of every entry, with a bad and a good snippet per framework', () => {
        for (const id of [...Object.keys(rules), 'allyproof/text-contrast', 'allyproof/non-text-contrast']) {
            const doc = ruleDoc(id)!;
            for (const field of ['message', 'why', 'fix'] as const) {
                assert.ok(doc[field].trim(), `${id}: ${field}`);
            }
            assert.ok(!doc.message.includes('\n'), `${id}: the message is one line`);
            assert.ok(doc.wcag.length > 0, `${id}: WCAG links`);
            for (const url of [...doc.wcag.map(link => link.url), ...doc.act.map(link => link.url)]) {
                assert.match(url, /^https:\/\/www\.w3\.org\/WAI\//, `${id}: ${url}`);
            }
            for (const framework of FRAMEWORKS) {
                const example = doc.examples[framework];
                assert.ok(example.bad.trim() && example.good.trim() && example.bad !== example.good, `${id}: ${framework} snippet`);
                assert.ok(example.language, `${id}: ${framework} code language`);
            }
        }
    });

    it('links the Understanding page of every criterion the rule reports', () => {
        for (const [id, criteria] of Object.entries(rules)) {
            const linked = ruleDoc(id)!.wcag.map(link => link.criterion);
            assert.deepStrictEqual(criteria.filter(c => !linked.includes(c)), [], id);
        }
    });

    // The component frameworks, with the language id they are checked as and the prefix of their engine's rule ids
    const COMPONENTS: { framework: Framework; languageId: string; prefix: string }[] = [
        { framework: 'jsx', languageId: 'javascriptreact', prefix: 'jsx-a11y-x/' },
        { framework: 'astro', languageId: 'astro', prefix: 'astro/' },
        { framework: 'vue', languageId: 'vue', prefix: 'vuejs-accessibility/' },
        { framework: 'svelte', languageId: 'svelte', prefix: 'svelte/' },
        { framework: 'angular', languageId: 'angular', prefix: '@angular-eslint/' }
    ];
    const component = (framework: Framework, code: string) => framework === 'jsx' ? `export const C = () => (\n${code}\n);` : code;

    it('writes snippets that parse in their framework', async () => {
        for (const entry of ENTRIES) {
            const doc = ruleDoc(entry.rules[0])!;
            for (const { framework, languageId } of COMPONENTS) {
                const example = doc.examples[framework];
                if (example.file) continue;
                for (const code of [example.bad, example.good]) {
                    await analyse({ languageId, text: component(framework, code) }).catch((error: Error) => {
                        assert.fail(`${entry.rules[0]} (${framework}): ${error.message}\n${code}`);
                    });
                }
            }
        }
    });

    it("shows a bad snippet the framework's engine reports and a good one it does not", async () => {
        for (const entry of ENTRIES) {
            const doc = ruleDoc(entry.rules[0])!;
            for (const { framework, languageId, prefix } of COMPONENTS) {
                const own = entry.rules.filter(rule => rule.startsWith(prefix));
                if (own.length === 0) continue;
                const reported = async (code: string) => (await analyse({ languageId, text: component(framework, code) }))
                    .findings.some(finding => own.includes(finding.ruleId));
                const { bad, good } = doc.examples[framework];
                assert.ok(await reported(bad), `${own[0]}: bad snippet not reported\n${bad}`);
                assert.ok(!await reported(good), `${own[0]}: good snippet reported\n${good}`);
            }
        }
    });
});
