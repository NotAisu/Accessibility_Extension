/**
 * Regenerates test/ground-truth/angular-eslint from the rule tests of @angular-eslint/eslint-plugin-template:
 *   git clone https://github.com/angular-eslint/angular-eslint.git <dir>
 *   git -C <dir> checkout v<version in package.json>
 *   npx ts-node test/ground-truth/import-angular-eslint.ts <dir>
 *
 * Each rule's cases.ts imports only types and convertAnnotatedSourceToFailureCase, so both are transpiled
 * and run from the clone; no install in the clone is needed. Only cases that run the rule the way the
 * Check does (default options) are kept. Each distinct snippet becomes one case: an invalid label
 * expects its criteria on the lines upstream annotates, a valid label expects the rule's criteria absent.
 * A valid label only clears the rule that tested the snippet: another rule sharing the criterion
 * can rightly report it, so the measured precision of shared criteria such as 4.1.2 is a lower bound.
 * Every case is measured as an external template and as the inline template of a component.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';
import { ELEMENTS_CONTENT_CRITERIA, RULE_CRITERIA } from '../../src/core/angular/engine';
import type { Expectation, GroundTruthSet } from './ground-truth';

type TestCase = string | { code: string; options?: unknown[]; errors?: { line: number; data?: { element?: string } }[] };
interface Labelled { rules: { invalid: Set<string>; valid: Set<string> }; lines: Map<string, Set<number>>; firstRule: string; outcome: string }

// The inline template starts on this line of the component file
const COMPONENT_HEADER = "import { Component } from '@angular/core';\n\n@Component({\n    selector: 'app-case',\n    template: `";
const TEMPLATE_LINE = 5;

function main(clone: string) {
    const pluginDir = path.join(clone, 'packages', 'eslint-plugin-template');
    const version = (JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf-8')) as { version: string }).version;
    const installed = (JSON.parse(fs.readFileSync(require.resolve('@angular-eslint/eslint-plugin-template/package.json'), 'utf-8')) as { version: string }).version;
    if (version !== installed) throw new Error(`The clone is v${version}, the installed plugin v${installed}`);
    const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const testUtils = run(path.join(clone, 'packages', 'test-utils', 'src', 'convert-annotated-source-to-failure-case.ts'), () => {
        throw new Error('convert-annotated-source-to-failure-case imports a module; extend the stubs');
    });

    const snippets = new Map<string, Labelled>();
    for (const rule of Object.keys(RULE_CRITERIA)) {
        const tests = run(path.join(pluginDir, 'tests', 'rules', rule, 'cases.ts'), specifier => {
            if (specifier === '@angular-eslint/test-utils') return testUtils;
            throw new Error(`${rule}/cases.ts imports ${specifier}; extend the stubs`);
        }) as { valid: TestCase[]; invalid: TestCase[] };
        for (const outcome of ['valid', 'invalid'] as const) {
            for (const test of tests[outcome]) {
                const code = typeof test === 'string' ? test : test.code;
                if (typeof test !== 'string' && (test.options ?? []).length > 0) continue;
                if (!snippets.has(code)) {
                    snippets.set(code, { rules: { invalid: new Set(), valid: new Set() }, lines: new Map(), firstRule: rule, outcome });
                }
                const snippet = snippets.get(code)!;
                snippet.rules[outcome].add(rule);
                for (const error of typeof test === 'string' ? [] : test.errors ?? []) {
                    for (const criterion of errorCriteria(rule, error.data?.element)) {
                        if (!snippet.lines.has(criterion)) snippet.lines.set(criterion, new Set());
                        snippet.lines.get(criterion)!.add(error.line);
                    }
                }
            }
        }
    }

    const outDir = path.join(__dirname, 'angular-eslint');
    const casesDir = path.join(outDir, 'cases');
    fs.rmSync(casesDir, { recursive: true, force: true });
    fs.mkdirSync(casesDir, { recursive: true });
    fs.copyFileSync(path.join(clone, 'LICENSE'), path.join(outDir, 'LICENSE'));
    const set: GroundTruthSet = {
        source: `https://github.com/angular-eslint/angular-eslint/tree/${commit} (v${version})`,
        cases: []
    };
    const counters = new Map<string, number>();
    for (const [code, { rules, lines, firstRule, outcome }] of snippets) {
        const absent = [...new Set([...rules.valid].flatMap(validCriteria))].filter(c => !lines.has(c));
        const key = `${firstRule}-${outcome}`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        const labels = [...[...rules.invalid].map(r => `${r} invalid`), ...[...rules.valid].map(r => `${r} valid`)].join(', ');
        const expect = (shift: number): Expectation[] => [
            ...[...lines].flatMap(([criterion, at]) => [...at].map(line => ({ criterion, line: line + shift }))),
            ...absent.map(criterion => ({ criterion, present: false }))
        ];
        const file = `cases/${key}-${counters.get(key)}`;
        fs.writeFileSync(path.join(outDir, `${file}.component.html`), code);
        set.cases.push({ file: `${file}.component.html`, languageId: 'angular', note: `@angular-eslint/eslint-plugin-template rule tests: ${labels}`, expect: expect(0) });
        // A backtick, ${ or backslash would change what the template literal holds
        if (/`|\$\{|\\/.test(code)) continue;
        fs.writeFileSync(path.join(outDir, `${file}.component.ts`), `${COMPONENT_HEADER}${code}\`\n})\nexport class CaseComponent {}\n`);
        set.cases.push({
            file: `${file}.component.ts`,
            languageId: 'typescript',
            note: `@angular-eslint/eslint-plugin-template rule tests, as an inline template: ${labels}`,
            expect: expect(TEMPLATE_LINE - 1)
        });
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Imported ${snippets.size} snippets from ${commit}`);
}

function errorCriteria(rule: string, element: string | undefined): string[] {
    if (rule !== 'elements-content') return RULE_CRITERIA[rule];
    return ELEMENTS_CONTENT_CRITERIA[element?.toLowerCase() ?? ''] ?? [];
}

// A valid elements-content snippet clears every element the rule checks
function validCriteria(rule: string): string[] {
    return rule === 'elements-content' ? [...new Set(Object.values(ELEMENTS_CONTENT_CRITERIA).flat())] : RULE_CRITERIA[rule];
}

// Transpiles a TypeScript module of the clone and returns its exports
function run(file: string, stubRequire: (specifier: string) => unknown): Record<string, unknown> {
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    const exports: Record<string, unknown> = {};
    const module = vm.runInThisContext(`(function (require, exports) {\n${outputText}\n})`, { filename: file }) as
        (require: typeof stubRequire, exports: object) => void;
    module(stubRequire, exports);
    return exports;
}

const clone = process.argv[2];
if (!clone) {
    console.error('Usage: npx ts-node test/ground-truth/import-angular-eslint.ts <angular-eslint clone>');
    process.exit(1);
}
main(path.resolve(clone));
