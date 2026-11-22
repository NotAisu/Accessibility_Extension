import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv';
import type { CheckOutput } from '../../src/cli/output';

// The packaged command line as a user or CI runs it: ALLYPROOF_CLI names the bundle, dist/cli.mjs by default
const CLI = path.resolve(process.env.ALLYPROOF_CLI ?? path.join(__dirname, '..', '..', 'dist', 'cli.mjs'));
const SCHEMA = path.join(__dirname, '..', '..', 'schema', 'check-result.v1.json');

// vuejs-accessibility/alt-text is a Proven rule in Vue, aria-role is Unproven.
const FAILING = '<template>\n  <img :src="chart">\n</template>\n';
const UNPROVEN_ONLY = '<template>\n  <div role="bogus">Text</div>\n</template>\n';
const CLEAN = '<template>\n  <img :src="chart" alt="Sales by month">\n</template>\n';

function repository(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allyproof-cli-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write(dir, files);
    git('add', '.');
    git('commit', '-q', '-m', 'base', '--allow-empty');
    return dir;
}

function write(dir: string, files: Record<string, string>) {
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
}

function run(cwd: string, args: string[], input?: string) {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: 'utf-8' });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const json = (stdout: string) => JSON.parse(stdout) as CheckOutput;
const blockingRules = (output: CheckOutput) => output.files.flatMap(f => f.findings.filter(x => !x.baselined).map(x => `${f.file}:${x.range.start.line} ${x.ruleId}`));

describe('allyproof check', function () {
    this.timeout(120_000);

    it('reports unnamed markup only where it is exposed', () => {
        const dir = repository({
            'Hidden.tsx': 'export default <main><div inert><img src="/hidden.png" /><button /><a href="/hidden" /></div><div style={{ visibility: "hidden" }}><button /></div></main>',
            'Visible.tsx': 'export default <div style={{ visibility: "hidden" }}><button style={{ visibility: "visible" }} /></div>',
            'Visible.astro': '<div style="display: none; display: block;"><img src="/visible.png"><button></button><a href="/visible"></a></div>',
            'Hidden.vue': '<template><iframe :src="null"></iframe><iframe src="/map" :style="{ display: \'none\' }"></iframe><iframe src="/map" v-if="!true"></iframe></template>',
            'Visible.vue': '<template><div style="display: none; display: block;"><iframe src="/map" :aria-hidden="false"></iframe></div></template>'
        });
        const result = run(dir, ['check', '--format', 'json']);

        assert.strictEqual(result.code, 1, result.stderr);
        assert.deepStrictEqual(blockingRules(json(result.stdout)).sort(), [
            'Visible.astro:1 allyproof/button-name',
            'Visible.astro:1 astro/jsx-a11y/alt-text',
            'Visible.astro:1 astro/jsx-a11y/anchor-has-content',
            'Visible.tsx:1 allyproof/button-name',
            'Visible.vue:1 vuejs-accessibility/iframe-has-title'
        ]);
    });

    it('keeps explicit button labels within their render scope', () => {
        const dir = repository({
            'Separate.tsx': 'const Unrelated = () => <label htmlFor="save">Save</label>; export const Main = () => <button id="save" />;',
            'Associated.tsx': 'export const Main = () => [<label htmlFor="save">Save</label>, <button id="save" />];'
        });
        const result = run(dir, ['check', '--format', 'json']);

        assert.strictEqual(result.code, 1, result.stderr);
        assert.deepStrictEqual(blockingRules(json(result.stdout)), ['Separate.tsx:1 allyproof/button-name']);
    });

    it('fails on a Finding with its file, line, rule, criterion and documentation link, and passes clean code', () => {
        const failing = run(repository({ 'src/Chart.vue': FAILING }), ['check']);
        const clean = run(repository({ 'src/Chart.vue': CLEAN }), ['check']);

        assert.strictEqual(failing.code, 1, failing.stdout + failing.stderr);
        assert.match(failing.stdout, /src\/Chart\.vue\n {2}2:3 .*WCAG 1\.1\.1 {2}vuejs-accessibility\/alt-text\n {6}https:\/\//);
        assert.strictEqual(clean.code, 0, clean.stdout + clean.stderr);
    });

    it('lists an Unproven rule\'s match as Needs Review and never fails on it', () => {
        const result = run(repository({ 'src/Map.vue': UNPROVEN_ONLY }), ['check', '--format', 'json']);

        assert.strictEqual(result.code, 0, result.stderr);
        const [file] = json(result.stdout).files;
        assert.deepStrictEqual(file.findings, []);
        assert.ok(file.needsReview.some(e => e.ruleId === 'vuejs-accessibility/aria-role' && e.proof === 'unproven' && e.range?.start.line === 2));
    });

    it('writes JSON that validates against the published schema, every Finding of a Proven rule', () => {
        const dir = repository({ 'index.html': '<!doctype html>\n<html lang="en"><head><title>T</title></head><body aria-hidden="true"><main><img src="a.png"></main></body></html>\n' });
        const output = json(run(dir, ['check', '--format', 'json']).stdout);

        const validate = new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(SCHEMA, 'utf-8')) as object);
        assert.ok(validate(output), JSON.stringify(validate.errors));
        assert.ok(output.files[0].findings.every(f => f.proof === 'proven'));
    });

    it('checks text from stdin as the named file, with the same results as the file on disk', () => {
        const dir = repository({ 'src/Chart.vue': FAILING });
        const disk = json(run(dir, ['check', 'src/Chart.vue', '--format', 'json']).stdout);
        const stdin = json(run(dir, ['check', '--stdin', '--stdin-filename', 'src/Chart.vue', '--format', 'json'], FAILING).stdout);

        assert.deepStrictEqual(stdin.files, disk.files);
    });

    it('checks the staged content, not the working copy', () => {
        const dir = repository({ 'src/Chart.vue': CLEAN });
        write(dir, { 'src/Chart.vue': FAILING });
        execFileSync('git', ['-C', dir, 'add', 'src/Chart.vue']);
        write(dir, { 'src/Chart.vue': CLEAN });

        assert.strictEqual(run(dir, ['check', '--staged']).code, 1);
        execFileSync('git', ['-C', dir, 'add', 'src/Chart.vue']);
        assert.strictEqual(run(dir, ['check', '--staged']).code, 0);
    });

    it('checks only the files changed since a base with --changed', () => {
        const dir = repository({ 'src/Old.vue': FAILING });
        write(dir, { 'src/New.vue': FAILING });

        const output = json(run(dir, ['check', '--changed', 'HEAD', '--format', 'json']).stdout);
        assert.deepStrictEqual(output.files.map(f => f.file), []);
        execFileSync('git', ['-C', dir, 'add', 'src/New.vue']);
        assert.deepStrictEqual(json(run(dir, ['check', '--changed', 'HEAD', '--format', 'json']).stdout).files.map(f => f.file), ['src/New.vue']);
    });

    it('honours ignore comments and the rule settings of .vscode/settings.json, comments and all', () => {
        const ignored = run(repository({ 'src/Chart.vue': '<template>\n  <!-- allyproof-ignore vuejs-accessibility/alt-text -->\n  <img :src="chart">\n</template>\n' }), ['check']);
        const settings = '{\n  // the team accepts these for now\n  "allyproof.rules": { "vuejs-accessibility/alt-text": "off", },\n}\n';
        const off = run(repository({ 'src/Chart.vue': FAILING, '.vscode/settings.json': settings }), ['check']);
        const bad = run(repository({ 'src/Chart.vue': FAILING, '.vscode/settings.json': '{ "allyproof.rules": { "x": "loud" } }' }), ['check']);

        assert.strictEqual(ignored.code, 0, ignored.stdout);
        assert.strictEqual(off.code, 0, off.stdout + off.stderr);
        assert.strictEqual(bad.code, 2);
        assert.match(bad.stderr, /allyproof\.rules/);
    });

    it('blocks only from the --fail-on severity up', () => {
        const dir = repository({ 'src/Chart.vue': FAILING });

        assert.strictEqual(run(dir, ['check', '--fail-on', 'error']).code, 0);
        assert.strictEqual(run(dir, ['check', '--fail-on', 'warning']).code, 1);
        assert.strictEqual(run(dir, ['check', '--fail-on', 'loud']).code, 2);
    });

    it('exits 3 with the parse position when a file cannot be parsed', () => {
        const result = run(repository({ 'src/Broken.tsx': 'export const A = () => <img src="a.png" ;\n' }), ['check']);

        assert.strictEqual(result.code, 3, result.stdout + result.stderr);
        assert.match(result.stdout, /src\/Broken\.tsx\n {2}could not be checked: .*[Pp]arse error at \d+:\d+/);
    });

    it('keeps baselined Findings from blocking when lines are inserted above them, and counts a fixed one', () => {
        const dir = repository({ 'src/Chart.vue': FAILING, 'src/Logo.vue': FAILING.replace('chart', 'logo') });
        assert.strictEqual(run(dir, ['baseline']).code, 0);
        write(dir, { 'src/Chart.vue': `<!-- a new comment -->\n\n${FAILING}`, 'src/Logo.vue': CLEAN });

        const moved = run(dir, ['check', '--format', 'json']);
        assert.strictEqual(moved.code, 0, moved.stdout);
        assert.deepStrictEqual({ ...json(moved.stdout).summary, needsReview: 0 }, { files: 2, failedFiles: 0, findings: 1, blocking: 0, baselined: 1, fixedSinceBaseline: 1, needsReview: 0 });
        write(dir, { 'src/Chart.vue': FAILING.replace('</template>', '  <img :src="second">\n</template>') });
        assert.deepStrictEqual(blockingRules(json(run(dir, ['check', '--format', 'json']).stdout)), ['src/Chart.vue:3 vuejs-accessibility/alt-text']);
    });

    it('writes SARIF 2.1.0 with Findings as results and Needs Review as notes', () => {
        const dir = repository({ 'src/Chart.vue': FAILING, 'src/Map.vue': UNPROVEN_ONLY });
        const sarif = JSON.parse(run(dir, ['check', '--format', 'sarif']).stdout) as { version: string; runs: { results: { ruleId: string; level: string; suppressions?: unknown[] }[] }[] };

        assert.strictEqual(sarif.version, '2.1.0');
        const levels = sarif.runs[0].results.map(r => `${r.ruleId} ${r.level}`);
        assert.ok(levels.includes('vuejs-accessibility/alt-text warning'), levels.join('\n'));
        assert.ok(levels.includes('vuejs-accessibility/aria-role note'), levels.join('\n'));
    });
});

describe('allyproof rules and explain', function () {
    this.timeout(60_000);

    it('lists every rule with its criteria, Layer and proof status, and explains each', () => {
        const dir = repository({});
        const { rules } = JSON.parse(run(dir, ['rules', '--format', 'json']).stdout) as { rules: { ruleId: string; criteria: string[]; layer: string; proof: Record<string, { proven: boolean }> }[] };

        assert.ok(rules.length > 50);
        assert.ok(rules.every(rule => rule.criteria.length > 0 && rule.layer === 'check'));
        assert.strictEqual(rules.find(rule => rule.ruleId === 'vuejs-accessibility/alt-text')?.proof.vue.proven, true);
        for (const { ruleId } of rules.filter((_, i) => i % 10 === 0)) {
            const explained = run(dir, ['explain', ruleId]);
            assert.strictEqual(explained.code, 0, `${ruleId}: ${explained.stderr}`);
            assert.match(explained.stdout, /\nWhy: .*\n\nHow to fix: .*\n\nFails.*:\n {4}<[\s\S]*Passes:\n {4}[\s\S]*Proof: /);
        }
        assert.strictEqual(run(dir, ['explain', 'no-such-rule']).code, 2);
    });
});
