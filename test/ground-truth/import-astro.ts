/**
 * Regenerates test/ground-truth/astro from the jsx-a11y rule fixtures of eslint-plugin-astro:
 *   git clone https://github.com/ota-meshi/eslint-plugin-astro.git <dir>
 *   git -C <dir> checkout v<version in package.json>
 *   npx ts-node test/ground-truth/import-astro.ts <dir>
 *
 * Each fixture of a rule mapped to a criterion becomes one case. Upstream asserts the rule's complete
 * error list, so the rule's criteria are expected on every line an error starts on, and absent from a
 * valid fixture. Fixtures with a config.json run the rule with options and are left out.
 * Only the tested rule is labelled: another rule sharing a criterion can rightly report it, so the
 * measured precision of shared criteria such as 4.1.2 is a lower bound.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RULE_CRITERIA } from '../../src/core/jsx/engine';
import type { Expectation, GroundTruthSet } from './ground-truth';

interface UpstreamError { line: number }

function main(clone: string) {
    const version = (JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf-8')) as { version: string }).version;
    const installed = (JSON.parse(fs.readFileSync(require.resolve('eslint-plugin-astro/package.json'), 'utf-8')) as { version: string }).version;
    if (version !== installed) throw new Error(`The clone is v${version}, the installed plugin v${installed}`);
    const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const fixtures = path.join(clone, 'tests', 'fixtures', 'rules', 'jsx-a11y');

    const outDir = path.join(__dirname, 'astro');
    const casesDir = path.join(outDir, 'cases');
    fs.rmSync(casesDir, { recursive: true, force: true });
    fs.mkdirSync(casesDir, { recursive: true });
    fs.copyFileSync(path.join(clone, 'LICENSE'), path.join(outDir, 'LICENSE'));
    const set: GroundTruthSet = {
        source: `https://github.com/ota-meshi/eslint-plugin-astro/tree/${commit}/tests/fixtures/rules/jsx-a11y (v${version})`,
        cases: []
    };
    for (const rule of fs.readdirSync(fixtures).filter(rule => RULE_CRITERIA[rule]).sort()) {
        for (const outcome of ['invalid', 'valid'] as const) {
            const dir = path.join(fixtures, rule, outcome);
            if (!fs.existsSync(dir)) continue;
            for (const input of fs.readdirSync(dir).filter(name => name.endsWith('-input.astro')).sort()) {
                if (fs.existsSync(path.join(dir, input.replace(/input\.astro$/, 'config.json')))) continue;
                const errorsFile = path.join(dir, input.replace(/input\.astro$/, 'errors.json'));
                const errors = outcome === 'invalid' ? JSON.parse(fs.readFileSync(errorsFile, 'utf-8')) as UpstreamError[] : [];
                const lines = [...new Set(errors.map(error => error.line))].sort((a, b) => a - b);
                const expect = RULE_CRITERIA[rule].flatMap((criterion): Expectation[] => lines.length > 0
                    ? lines.map(line => ({ criterion, line }))
                    : [{ criterion, present: false }]);
                const file = `cases/${rule}-${outcome}-${input.replace(/-input\.astro$/, '')}.astro`;
                fs.copyFileSync(path.join(dir, input), path.join(outDir, file));
                set.cases.push({ file, languageId: 'astro', note: `eslint-plugin-astro fixture jsx-a11y/${rule}/${outcome}/${input}`, expect });
            }
        }
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Imported ${set.cases.length} fixtures from ${commit}`);
}

const clone = process.argv[2];
if (!clone) {
    console.error('Usage: npx ts-node test/ground-truth/import-astro.ts <eslint-plugin-astro clone>');
    process.exit(1);
}
main(path.resolve(clone));
