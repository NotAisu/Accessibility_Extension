/**
 * Rechecks the upstream files affected by #85 through the packaged worker.
 * Use the pinned clones from generate-injection.ts and run npm run bundle first:
 *   npx ts-node test/ground-truth/check-parser-corpus.ts <source directory>
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import assert from 'node:assert/strict';
import { compile } from 'svelte/compiler';
import * as tsParser from '@typescript-eslint/parser';
import * as vueParser from 'vue-eslint-parser';
import { AnalysisWorker } from '../../src/analysis-worker';

const SOURCES = [
    { name: 'element-plus', commit: '7c07ff389d7d39fc59ab8214689bcd90b46a5487', languageId: 'vue' },
    { name: 'skeleton', commit: '38f596fabb0b529ae0f7781c7212c00fd4435fc4', languageId: 'svelte' },
    { name: 'sveltekit', commit: '1cda796508aa14efd3b7832f3290a8f04eb88526', languageId: 'svelte' }
] as const;

function priorFailure(text: string, languageId: 'vue' | 'svelte'): boolean {
    if (languageId === 'vue' && !/<script\b[^>]*\blang\s*=\s*['"]tsx['"]/i.test(text)) return false;
    try {
        if (languageId === 'vue') {
            vueParser.parseForESLint(text, { filePath: 'document.vue', ecmaVersion: 'latest', sourceType: 'module', parser: { ts: tsParser } });
        } else {
            compile(text, { generate: false, modernAst: true });
        }
        return false;
    } catch (error) {
        return languageId === 'vue' || (error as { code?: string }).code === 'experimental_async';
    }
}

async function main(sourcesDir: string): Promise<void> {
    const worker = new AnalysisWorker(path.resolve('dist/worker.mjs'), { deadlineMs: 30_000 });
    try {
        for (const { name, commit, languageId } of SOURCES) {
            const cwd = path.resolve(sourcesDir, name);
            assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(), commit, name);
            assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' }).trim(), '', `${name}: tracked files differ from the pinned commit`);
            const files = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' }).split('\0');
            let checked = 0;
            for (const file of files.filter(file => file.endsWith(`.${languageId}`))) {
                const text = fs.readFileSync(path.join(cwd, file), 'utf8');
                if (!priorFailure(text, languageId)) continue;
                const result = await worker.check(file, { languageId, text });
                assert.equal(result.status, 'done', `${name}/${file}: ${JSON.stringify(result)}`);
                checked++;
            }
            assert.ok(checked > 0, `No #85 failures reproduced in ${name}`);
            console.log(`${name}: ${checked} previously failing files checked by the bundle`);
        }
    } finally {
        worker.dispose();
    }
}

const sourcesDir = process.argv[2];
assert.ok(sourcesDir, 'Pass the directory containing the pinned source clones');
void main(sourcesDir);
