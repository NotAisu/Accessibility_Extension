/**
 * Regenerates test/ground-truth/vuejs-accessibility from the rule tests of eslint-plugin-vuejs-accessibility:
 *   git clone https://github.com/vue-a11y/eslint-plugin-vuejs-accessibility.git <dir>
 *   git -C <dir> checkout v<version in package.json>
 *   npx ts-node test/ground-truth/import-vuejs-accessibility.ts <dir>
 *
 * Each spec imports only its rule and the makeRuleTester helper, so it is transpiled and run with the
 * installed rule (some specs read its exported role lists) and a recording helper; no install in the
 * clone is needed. The helper wraps every snippet in <template>,
 * as done here. Only cases that run the rule the way the Check does (its options, else the defaults) are kept.
 * Each distinct snippet becomes one case: its criteria are present when a rule mapped to them labels
 * it invalid, absent when such a rule labels it valid.
 * A valid label only clears the rule that tested the snippet: another rule sharing the criterion
 * can rightly report it, so the measured precision of shared criteria such as 4.1.2 is a lower bound.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';
import vueA11y from 'eslint-plugin-vuejs-accessibility';
import { RULE_CRITERIA, RULE_OPTIONS } from '../../src/core/vue/engine';
import type { GroundTruthSet } from './ground-truth';

type TestCase = string | { code: string; options?: unknown[] };
interface Labelled { rules: { invalid: Set<string>; valid: Set<string> }; firstRule: string; outcome: string }

// interactive-supports-focus tests every interactive role with every handler, which would outweigh
// every other rule sharing 2.1.1; an evenly spaced sample keeps each role represented
const MAX_PER_RULE = 100;

// Options the rule treats as its defaults: without options interactive-supports-focus falls back to tabbable: []
const SPELLED_OUT_DEFAULTS: Record<string, unknown[]> = {
    'interactive-supports-focus': [{ tabbable: [] }]
};

function main(clone: string) {
    const version = (JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf-8')) as { version: string }).version;
    const installed = (JSON.parse(fs.readFileSync(require.resolve('eslint-plugin-vuejs-accessibility/package.json'), 'utf-8')) as { version: string }).version;
    if (version !== installed) throw new Error(`The clone is v${version}, the installed plugin v${installed}`);
    const rules = vueA11y.rules as Record<string, unknown>;
    const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

    const snippets = new Map<string, Labelled>();
    const specs = path.join(clone, 'src', 'rules', '__tests__');
    for (const file of fs.readdirSync(specs).filter(f => f.endsWith('.test.ts')).sort()) {
        let rule: string | undefined;
        const makeRuleTester = (_name: string, _module: unknown, tests: { valid: TestCase[]; invalid: TestCase[] }) => {
            if (!rule || !RULE_CRITERIA[rule]) return;
            for (const outcome of ['valid', 'invalid'] as const) {
                const codes = [...new Set(tests[outcome].map(test => checkedCode(test, rule!)).filter((code): code is string => code !== undefined))];
                for (const code of evenly(codes, MAX_PER_RULE)) {
                    if (!snippets.has(code)) {
                        snippets.set(code, { rules: { invalid: new Set(), valid: new Set() }, firstRule: rule, outcome });
                    }
                    snippets.get(code)!.rules[outcome].add(rule);
                }
            }
        };
        // Spec names may not match the rule they test; the imported rule module does
        const stubRequire = (specifier: string) => {
            if (specifier === './makeRuleTester') return { __esModule: true, default: makeRuleTester };
            if (specifier.startsWith('../')) {
                rule = specifier.slice(3);
                return { __esModule: true, default: rules[rule] };
            }
            throw new Error(`${file} imports ${specifier}; extend the stubs`);
        };
        const { outputText } = ts.transpileModule(fs.readFileSync(path.join(specs, file), 'utf-8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        });
        const spec = vm.runInThisContext(`(function (require, exports) {\n${outputText}\n})`, { filename: file }) as
            (require: typeof stubRequire, exports: object) => void;
        spec(stubRequire, {});
    }

    const outDir = path.join(__dirname, 'vuejs-accessibility');
    const casesDir = path.join(outDir, 'cases');
    fs.rmSync(casesDir, { recursive: true, force: true });
    fs.mkdirSync(casesDir, { recursive: true });
    fs.copyFileSync(path.join(clone, 'LICENSE'), path.join(outDir, 'LICENSE'));
    const set: GroundTruthSet = {
        source: `https://github.com/vue-a11y/eslint-plugin-vuejs-accessibility/tree/${commit} (v${version})`,
        cases: []
    };
    const counters = new Map<string, number>();
    for (const [code, { rules, firstRule, outcome }] of snippets) {
        const present = new Set([...rules.invalid].flatMap(rule => RULE_CRITERIA[rule]));
        const absent = new Set([...rules.valid].flatMap(rule => RULE_CRITERIA[rule]).filter(c => !present.has(c)));
        const key = `${firstRule}-${outcome}`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        const file = `cases/${key}-${counters.get(key)}.vue`;
        fs.writeFileSync(path.join(outDir, file), `<template>${code}</template>\n`);
        const labels = [...[...rules.invalid].map(r => `${r} invalid`), ...[...rules.valid].map(r => `${r} valid`)].join(', ');
        set.cases.push({
            file,
            languageId: 'vue',
            note: `eslint-plugin-vuejs-accessibility rule tests: ${labels}`,
            expect: [
                ...[...present].map(criterion => ({ criterion, present: true })),
                ...[...absent].map(criterion => ({ criterion, present: false }))
            ]
        });
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Imported ${snippets.size} snippets from ${commit}`);
}

// The code of a case that runs the rule with the options the Check runs it with
function checkedCode(test: TestCase, rule: string): string | undefined {
    const code = typeof test === 'string' ? test : test.code;
    const options = JSON.stringify((typeof test === 'string' ? undefined : test.options?.[0]) ?? {});
    const checked = RULE_OPTIONS[rule]?.[0] ?? SPELLED_OUT_DEFAULTS[rule]?.[0];
    const runsAsChecked = options === JSON.stringify(checked ?? {}) || (!RULE_OPTIONS[rule] && options === '{}');
    return runsAsChecked ? code : undefined;
}

function evenly<T>(items: T[], max: number): T[] {
    if (items.length <= max) return items;
    return Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]);
}

const clone = process.argv[2];
if (!clone) {
    console.error('Usage: npx ts-node test/ground-truth/import-vuejs-accessibility.ts <eslint-plugin-vuejs-accessibility clone>');
    process.exit(1);
}
main(path.resolve(clone));
