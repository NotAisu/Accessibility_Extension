import * as assert from 'assert';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

// The Check's budget while typing (#17): 150 ms warm p95 per typical file. The first run also loads the
// engine and is measured on its own; the analysis worker gives it a longer deadline.
const WARM_P95_MS = 150;
const FIRST_LOAD_MS = 5000;
const WARM_RUNS = 40;

const TYPICAL = path.join(__dirname, 'fixtures', 'typical');
const MEASURE = path.join(__dirname, 'fixtures', 'measure-check.ts');

const FILES: [file: string, languageId: string][] = [
    ['page.html', 'html'],
    ['card-list.jsx', 'javascriptreact'],
    ['signup-form.tsx', 'typescriptreact'],
    ['todo-list.vue', 'vue'],
    ['nav-menu.svelte', 'svelte'],
    ['layout.astro', 'astro'],
    ['profile.component.html', 'angular'],
    ['orders.component.ts', 'typescript']
];

function p95(times: number[]): number {
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

describe('Check performance', function () {
    this.timeout(60_000);

    for (const [file, languageId] of FILES) {
        it(`checks a typical ${languageId} file within the budget (${file})`, async () => {
            // A fresh process, so the first run loads the engine as in a new analysis worker. Transpiled only:
            // type checking the source would count as loading
            const { stdout } = await promisify(execFile)(
                process.execPath,
                ['--no-experimental-strip-types', '-r', 'ts-node/register', MEASURE, path.join(TYPICAL, file), languageId, String(WARM_RUNS)],
                { env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } }
            );
            const { firstLoad, warm } = JSON.parse(stdout) as { firstLoad: number; warm: number[] };

            assert.ok(firstLoad < FIRST_LOAD_MS, `first load took ${Math.round(firstLoad)} ms`);
            assert.ok(p95(warm) < WARM_P95_MS, `warm p95 was ${Math.round(p95(warm))} ms`);
        });
    }
});
