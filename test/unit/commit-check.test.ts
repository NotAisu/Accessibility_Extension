import * as assert from 'assert';
import { planCommitCheck } from '../../src/commit-check';

const project = (files: Record<string, string>) => (path: string) => Promise.resolve(files[path]);
const plan = (files: Record<string, string>, workflow = false) => planCommitCheck(project(files), { workflow, actionRef: 'NotAisu/Accessibility_Extension@v0.2.0' });
const afterOf = async (files: Record<string, string>, path: string) => (await plan(files)).files.find(file => file.path === path)?.after;

describe('Set Up Commit Check', () => {
    it('adds a command to an existing lefthook pre-commit hook, keeping its other commands', async () => {
        const lefthook = 'pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n';

        const after = await afterOf({ 'lefthook.yml': lefthook }, 'lefthook.yml');

        assert.strictEqual(after, 'pre-commit:\n  commands:\n    allyproof:\n      glob: "*.{html,htm,vue,svelte,jsx,tsx,astro,ts}"\n      run: npx --yes allyproof check --staged\n    lint:\n      run: npm run lint\n');
    });

    it('adds a pre-commit hook to a lefthook config without one', async () => {
        const after = await afterOf({ 'lefthook.yml': 'pre-push:\n  commands:\n    test:\n      run: npm test\n' }, 'lefthook.yml');

        assert.match(after!, /^pre-push:[\s\S]*\n\npre-commit:\n {2}commands:\n {4}allyproof:\n/);
    });

    it('adds Allyproof to lint-staged in package.json when Husky runs lint-staged', async () => {
        const manifest = JSON.stringify({ name: 'app', devDependencies: { allyproof: '0.2.0' }, 'lint-staged': { '*.ts': 'eslint' } }, null, 2) + '\n';

        const result = await plan({ '.husky/pre-commit': 'npx lint-staged\n', 'package.json': manifest });

        assert.strictEqual(result.manager, 'Husky with lint-staged');
        const written = JSON.parse(result.files[0].after) as { 'lint-staged': Record<string, unknown> };
        assert.deepStrictEqual(written['lint-staged'], { '*.ts': 'eslint', '*.{html,htm,vue,svelte,jsx,tsx,astro,ts}': 'npx allyproof check' });
    });

    it('appends the staged check to Husky\'s pre-commit hook without lint-staged', async () => {
        const after = await afterOf({ '.husky/pre-commit': 'npm test\n', 'pnpm-lock.yaml': '' }, '.husky/pre-commit');

        assert.strictEqual(after, 'npm test\npnpm dlx allyproof check --staged\n');
    });

    it('adds a local hook to the pre-commit framework at the indent of its other repos', async () => {
        const config = 'repos:\n  - repo: https://github.com/pre-commit/pre-commit-hooks\n    rev: v5.0.0\n    hooks:\n      - id: trailing-whitespace\n';

        const after = await afterOf({ '.pre-commit-config.yaml': config }, '.pre-commit-config.yaml');

        assert.ok(after!.startsWith(config), after);
        assert.match(after!.slice(config.length), /^ {2}- repo: local\n {4}hooks:\n {6}- id: allyproof\n {8}name: Allyproof\n {8}entry: npx --yes allyproof check\n/);
    });

    it('writes a plain Git hook, executable, when the project has no hook manager', async () => {
        const result = await plan({});

        assert.strictEqual(result.manager, 'a Git hook');
        assert.deepStrictEqual(result.files, [{ path: '.git/hooks/pre-commit', before: undefined, after: '#!/bin/sh\nnpx --yes allyproof check --staged\n', executable: true }]);
    });

    it('changes nothing where Allyproof already runs, and adds the workflow only when asked and missing', async () => {
        const done = { 'lefthook.yml': 'pre-commit:\n  commands:\n    allyproof:\n      run: npx allyproof check --staged\n' };

        assert.deepStrictEqual((await plan(done)).files, []);
        const withWorkflow = await plan(done, true);
        assert.deepStrictEqual(withWorkflow.files.map(file => file.path), ['.github/workflows/allyproof.yml']);
        assert.match(withWorkflow.files[0].after, /uses: NotAisu\/Accessibility_Extension@v0\.2\.0\n/);
        assert.deepStrictEqual((await plan({ ...done, '.github/workflows/allyproof.yml': 'x' }, true)).files, []);
    });
});
