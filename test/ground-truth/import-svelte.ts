/**
 * Regenerates test/ground-truth/svelte from the Svelte compiler's a11y validator samples:
 *   git clone https://github.com/sveltejs/svelte.git <dir>
 *   git -C <dir> checkout svelte@<version in package.json>
 *   npx ts-node test/ground-truth/import-svelte.ts <dir>
 *
 * Each a11y-* sample becomes one case. Upstream asserts the sample's complete warning list, so a
 * criterion is expected on every line a warning mapped to it starts on, and absent from the file
 * when no warning maps to it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { criteriaOf, MISSING_ATTRIBUTE_CRITERIA, WARNING_CRITERIA } from '../../src/core/svelte/engine';
import type { Expectation, GroundTruthSet } from './ground-truth';

interface UpstreamWarning { code: string; message: string; start: { line: number } }

// The criteria the Check can report for Svelte
const CHECKED_CRITERIA = new Set([...Object.values(WARNING_CRITERIA), ...Object.values(MISSING_ATTRIBUTE_CRITERIA)].flat());

function main(clone: string) {
    const version = (JSON.parse(fs.readFileSync(path.join(clone, 'packages', 'svelte', 'package.json'), 'utf-8')) as { version: string }).version;
    const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const samples = path.join(clone, 'packages', 'svelte', 'tests', 'validator', 'samples');

    const outDir = path.join(__dirname, 'svelte');
    const casesDir = path.join(outDir, 'cases');
    fs.rmSync(casesDir, { recursive: true, force: true });
    fs.mkdirSync(casesDir, { recursive: true });
    fs.copyFileSync(path.join(clone, 'LICENSE.md'), path.join(outDir, 'LICENSE.md'));
    const set: GroundTruthSet = {
        source: `https://github.com/sveltejs/svelte/tree/${commit}/packages/svelte/tests/validator/samples (v${version})`,
        cases: []
    };
    for (const sample of fs.readdirSync(samples).filter(name => name.startsWith('a11y-')).sort()) {
        const dir = path.join(samples, sample);
        // Samples with options or expected errors test something other than the default compile
        if (!fs.existsSync(path.join(dir, 'input.svelte')) || fs.existsSync(path.join(dir, 'options.json')) || fs.existsSync(path.join(dir, 'errors.json'))) continue;
        // Upstream compiles the input with trailing whitespace and carriage returns removed
        const input = fs.readFileSync(path.join(dir, 'input.svelte'), 'utf-8').replace(/\s+$/, '').replace(/\r/g, '');
        const warningsFile = path.join(dir, 'warnings.json');
        const warnings = fs.existsSync(warningsFile) ? JSON.parse(fs.readFileSync(warningsFile, 'utf-8')) as UpstreamWarning[] : [];
        const lines = new Map<string, Set<number>>();
        for (const warning of warnings) {
            for (const criterion of criteriaOf(warning.code, warning.message) ?? []) {
                if (!lines.has(criterion)) lines.set(criterion, new Set());
                lines.get(criterion)!.add(warning.start.line);
            }
        }
        const expect: Expectation[] = [
            ...[...lines].flatMap(([criterion, at]) => [...at].sort((a, b) => a - b).map(line => ({ criterion, line }))),
            ...[...CHECKED_CRITERIA].filter(criterion => !lines.has(criterion)).map(criterion => ({ criterion, present: false }))
        ];
        const file = `cases/${sample}.svelte`;
        fs.writeFileSync(path.join(outDir, file), input + '\n');
        set.cases.push({ file, languageId: 'svelte', note: `Svelte compiler validator sample ${sample}`, expect });
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Imported ${set.cases.length} samples from ${commit}`);
}

const clone = process.argv[2];
if (!clone) {
    console.error('Usage: npx ts-node test/ground-truth/import-svelte.ts <svelte clone>');
    process.exit(1);
}
main(path.resolve(clone));
