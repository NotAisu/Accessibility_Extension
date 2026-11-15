/**
 * Regenerates test/ground-truth/jsx-a11y from the rule tests of eslint-plugin-jsx-a11y-x:
 *   git clone https://github.com/es-tooling/eslint-plugin-jsx-a11y-x.git <dir>
 *   git -C <dir> checkout v<version in package.json>
 *   (cd <dir> && pnpm install)
 *   npx ts-node test/ground-truth/import-jsx-a11y.ts <dir>
 *
 * Only cases that run the rule the way the Check does (its options, no settings, the default
 * parser) are kept, at most MAX_PER_RULE per rule and outcome. Each distinct snippet becomes one
 * case: its criteria are present when a rule mapped to them labels it invalid, absent when such a
 * rule labels it valid.
 * A valid label only clears the rule that tested the snippet: another rule sharing the criterion
 * can rightly report it (aria-props' valid <div aria-colspan="foobar" /> fails aria-proptypes), so
 * the measured precision of shared criteria such as 4.1.2 is a lower bound.
 * Every case is measured as JSX and as TSX.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { createRequire, registerHooks } from 'module';
import * as path from 'path';
import { RULE_CRITERIA, RULE_OPTIONS } from '../../src/core/jsx/engine';
import type { GroundTruthSet } from './ground-truth';

type TestCase = string | { code: string; options?: unknown[]; settings?: object };
interface Labelled { rules: { invalid: Set<string>; valid: Set<string> }; firstRule: string; outcome: string }

// role-supports-aria-props generates thousands of role/attribute permutations, which would outweigh
// every other rule sharing 4.1.2; an evenly spaced sample keeps each role represented
const MAX_PER_RULE = 100;

// One spec also tests a helper with vitest, which only runs inside the vitest runner
const VITEST_STUB = 'data:text/javascript,const noop = () => {}; export const test = noop, expect = noop, describe = noop, it = noop;';

function main(clone: string) {
    const version = (JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf-8')) as { version: string }).version;
    const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    registerHooks({
        resolve: (specifier, context, next) => {
            if (specifier === 'vitest') return { url: VITEST_STUB, shortCircuit: true };
            try {
                return next(specifier, context);
            } catch (error) {
                // The plugin's sources mix .js and .ts files and import both as .js
                if (!specifier.endsWith('.js')) throw error;
                return next(specifier.replace(/\.js$/, '.ts'), context);
            }
        }
    });
    const cloneRequire = createRequire(path.join(clone, 'package.json'));
    const { RuleTester } = cloneRequire('eslint') as typeof import('eslint');
    // Spec names are not reliable (iframe-has-title's spec runs as html-has-lang), the rule modules are
    const { default: { rules } } = cloneRequire(path.join(clone, 'src', 'index.js')) as { default: { rules: Record<string, unknown> } };
    const nameOf = new Map(Object.entries(rules).map(([name, module]) => [module, name]));

    const snippets = new Map<string, Labelled>();
    RuleTester.prototype.run = (_name: string, module: unknown, tests: { valid: TestCase[]; invalid: TestCase[] }) => {
        const rule = nameOf.get(module);
        if (!rule || !RULE_CRITERIA[rule]) return;
        const asChecked = (test: TestCase) => checkedCode(test, RULE_OPTIONS[rule]);
        for (const outcome of ['valid', 'invalid'] as const) {
            const codes = [...new Set(tests[outcome].map(asChecked).filter((code): code is string => code !== undefined))];
            for (const code of evenly(codes, MAX_PER_RULE)) {
                if (!snippets.has(code)) {
                    snippets.set(code, { rules: { invalid: new Set(), valid: new Set() }, firstRule: rule, outcome });
                }
                snippets.get(code)!.rules[outcome].add(rule);
            }
        }
    };
    const specs = path.join(clone, '__tests__', 'src', 'rules');
    for (const file of fs.readdirSync(specs).filter(f => f.endsWith('.spec.js')).sort()) {
        cloneRequire(path.join(specs, file));
    }

    const outDir = path.join(__dirname, 'jsx-a11y');
    const casesDir = path.join(outDir, 'cases');
    fs.rmSync(casesDir, { recursive: true, force: true });
    fs.mkdirSync(casesDir, { recursive: true });
    fs.copyFileSync(path.join(clone, 'LICENSE'), path.join(outDir, 'LICENSE'));
    const set: GroundTruthSet = {
        source: `https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/tree/${commit} (v${version})`,
        cases: []
    };
    const counters = new Map<string, number>();
    for (const [code, { rules, firstRule, outcome }] of snippets) {
        const present = new Set([...rules.invalid].flatMap(rule => RULE_CRITERIA[rule]));
        const absent = new Set([...rules.valid].flatMap(rule => RULE_CRITERIA[rule]).filter(c => !present.has(c)));
        const key = `${firstRule}-${outcome}`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        const file = `cases/${key}-${counters.get(key)}.jsx`;
        fs.writeFileSync(path.join(outDir, file), code + '\n');
        const expect = [
            ...[...present].map(criterion => ({ criterion, present: true })),
            ...[...absent].map(criterion => ({ criterion, present: false }))
        ];
        const labels = [...[...rules.invalid].map(r => `${r} invalid`), ...[...rules.valid].map(r => `${r} valid`)].join(', ');
        for (const languageId of ['javascriptreact', 'typescriptreact']) {
            set.cases.push({ file, languageId, note: `eslint-plugin-jsx-a11y-x rule tests: ${labels}`, expect });
        }
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Imported ${snippets.size} snippets from ${commit}`);
}

// The code of a case that runs the way the Check runs the rule: the Check's options, no settings and
// the default parser. The parser helper repeats each case for babel and typescript-eslint and appends
// a comment naming the parser, options and settings.
function checkedCode(test: TestCase, options: unknown[]): string | undefined {
    if (typeof test === 'string') return options.length === 0 ? test : undefined;
    if (JSON.stringify(test.options?.[0] ?? {}) !== JSON.stringify(options[0] ?? {})) return undefined;
    if (test.settings && Object.keys(test.settings).length > 0) return undefined;
    const comment = /\n\/\/ parser: (.*)$/.exec(test.code);
    if (comment && !/^default(, options: .*)?$/.test(comment[1])) return undefined;
    return comment ? test.code.slice(0, comment.index) : test.code;
}

function evenly<T>(items: T[], max: number): T[] {
    if (items.length <= max) return items;
    return Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]);
}

const clone = process.argv[2];
if (!clone) {
    console.error('Usage: npx ts-node test/ground-truth/import-jsx-a11y.ts <eslint-plugin-jsx-a11y-x clone>');
    process.exit(1);
}
main(path.resolve(clone));
