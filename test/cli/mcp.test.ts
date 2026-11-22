import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CheckOutput } from '../../src/cli/output';

// The packaged MCP server as an MCP client runs it: `allyproof mcp` of the bundle ALLYPROOF_CLI names, over stdio
const CLI = path.resolve(process.env.ALLYPROOF_CLI ?? path.join(__dirname, '..', '..', 'dist', 'cli.mjs'));
const SCHEMA = path.join(__dirname, '..', '..', 'schema', 'check-result.v1.json');

// vuejs-accessibility/alt-text is a Proven rule in Vue
const FAILING = '<template>\n  <img :src="chart">\n</template>\n';

function project(files: Record<string, string>): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'allyproof-mcp-')));
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
    return dir;
}

function cli(cwd: string, args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
}

async function connect(cwd: string): Promise<Client> {
    const client = new Client({ name: 'allyproof-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], cwd, stderr: 'ignore' }));
    return client;
}

interface ToolResult {
    isError?: boolean;
    content: { type: string; text: string }[];
}

async function check(client: Client, args: Record<string, unknown>): Promise<ToolResult> {
    return await client.callTool({ name: 'check', arguments: args }) as ToolResult;
}

const output = (result: ToolResult) => {
    assert.ok(!result.isError, result.content[0]?.text);
    return JSON.parse(result.content[0].text) as CheckOutput;
};

describe('allyproof mcp', function () {
    this.timeout(120_000);
    let client: Client | undefined;
    afterEach(async () => {
        await client?.close();
        client = undefined;
    });

    it('offers a read-only check tool', async () => {
        client = await connect(project({}));
        const { tools } = await client.listTools();

        const tool = tools.find(t => t.name === 'check');
        assert.ok(tool, tools.map(t => t.name).join(', '));
        assert.strictEqual(tool.annotations?.readOnlyHint, true);
    });

    it('checks a file and the same text as code with the result of allyproof check --format json', async () => {
        const dir = project({ 'src/Chart.vue': FAILING });
        const expected = JSON.parse(cli(dir, ['check', 'src/Chart.vue', '--format', 'json']).stdout) as CheckOutput;
        client = await connect(dir);

        assert.strictEqual(expected.summary.findings, 1);
        assert.deepStrictEqual(output(await check(client, { paths: ['src/Chart.vue'] })), expected);
        assert.deepStrictEqual(output(await check(client, { code: FAILING, path: 'src/Chart.vue' })), expected);
    });

    it('reports a file that cannot be parsed as a tool error with the reason, not as an empty result', async () => {
        client = await connect(project({ 'src/Broken.tsx': 'export const A = () => <img src="a.png" ;\n' }));

        for (const args of [{ paths: ['src/Broken.tsx'] }, { code: 'export const A = () => <img src="a.png" ;\n', languageId: 'typescriptreact' }]) {
            const result = await check(client, args);
            assert.strictEqual(result.isError, true, JSON.stringify(args));
            assert.match(result.content[0].text, /could not be checked: .*[Pp]arse error at \d+:\d+/);
        }
    });

    it('rejects paths outside the working directory, also through a symlink', async () => {
        const outside = project({ 'Secret.vue': FAILING });
        const dir = project({ 'src/Chart.vue': FAILING });
        fs.symlinkSync(path.join(outside, 'Secret.vue'), path.join(dir, 'src', 'Link.vue'));
        client = await connect(dir);

        for (const args of [
            { paths: ['../' + path.basename(outside) + '/Secret.vue'] },
            { paths: [path.join(outside, 'Secret.vue')] },
            { paths: ['src/Link.vue'] },
            { code: FAILING, path: '../Elsewhere.vue' }
        ]) {
            const result = await check(client, args);
            assert.strictEqual(result.isError, true, JSON.stringify(args));
            assert.match(result.content[0].text, /outside the project/);
        }
    });

    it('honours ignore comments and the rule settings of .vscode/settings.json', async () => {
        const ignoredText = '<template>\n  <!-- allyproof-ignore vuejs-accessibility/alt-text -->\n  <img :src="chart">\n</template>\n';
        client = await connect(project({ 'src/Ignored.vue': ignoredText }));
        assert.strictEqual(output(await check(client, { paths: ['src/Ignored.vue'] })).summary.findings, 0);
        await client.close();

        const settings = '{\n  // the team accepts these for now\n  "allyproof.rules": { "vuejs-accessibility/alt-text": "off", },\n}\n';
        client = await connect(project({ 'src/Chart.vue': FAILING, '.vscode/settings.json': settings }));
        assert.strictEqual(output(await check(client, { paths: ['src/Chart.vue'] })).summary.findings, 0);
        assert.strictEqual(output(await check(client, { code: FAILING, languageId: 'vue' })).summary.findings, 0);
    });

    it('returns the same result for the same input', async () => {
        client = await connect(project({ 'src/Chart.vue': FAILING, 'src/Map.vue': '<template>\n  <div role="bogus">Text</div>\n</template>\n' }));
        const args = { paths: ['src/Chart.vue', 'src/Map.vue'] };

        assert.deepStrictEqual(await check(client, args), await check(client, args));
    });

    it('checks a folder under the limit with every Finding, the counts and truncated false', async () => {
        const dir = project({ 'src/Chart.vue': FAILING, 'src/maps/Map.vue': FAILING, 'src/notes.txt': 'not checked', 'other/Skip.vue': FAILING });
        const expected = JSON.parse(cli(dir, ['check', 'src', '--format', 'json']).stdout) as CheckOutput;
        client = await connect(dir);

        const result = output(await check(client, { paths: ['src'] }));
        assert.deepStrictEqual(result.files, expected.files);
        assert.deepStrictEqual(result.files.map(file => file.file), ['src/Chart.vue', 'src/maps/Map.vue']);
        assert.strictEqual(result.truncated, false);
        assert.deepStrictEqual(result.summary.byFile, { 'src/Chart.vue': 1, 'src/maps/Map.vue': 1 });
        assert.deepStrictEqual(result.summary.byRule, { 'vuejs-accessibility/alt-text': 2 });
        assert.deepStrictEqual(result.summary.byCriterion, { '1.1.1': 2 });
        const validate = new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(SCHEMA, 'utf-8')) as object);
        assert.ok(validate(result), JSON.stringify(validate.errors));
    });

    it('checks a folder over the limit with the full summary, the first files only, truncated true and a hint', async () => {
        const dir = project({ 'src/A.vue': FAILING, 'src/B.vue': FAILING, 'src/c/C.vue': FAILING, 'src/D.vue': '<template>\n  <p>Clean</p>\n</template>\n' });
        client = await connect(dir);
        const args = { paths: ['src'], limit: 2 };

        const result = output(await check(client, args));
        assert.deepStrictEqual(result.files.map(file => file.file), ['src/A.vue', 'src/B.vue']);
        assert.strictEqual(result.truncated, true);
        assert.strictEqual(result.summary.files, 4);
        assert.strictEqual(result.summary.findings, 3);
        assert.deepStrictEqual(result.summary.byFile, { 'src/A.vue': 1, 'src/B.vue': 1, 'src/c/C.vue': 1 });
        assert.deepStrictEqual(result.summary.byRule, { 'vuejs-accessibility/alt-text': 3 });
        assert.match(result.hint ?? '', /first 2 of 4 files.*paths/);
        assert.deepStrictEqual(await check(client, args), await check(client, args));
    });

    it('leaves out a symlink in a folder that points outside the project', async () => {
        const outside = project({ 'Secret.vue': FAILING });
        const dir = project({ 'src/Chart.vue': FAILING });
        fs.symlinkSync(path.join(outside, 'Secret.vue'), path.join(dir, 'src', 'Link.vue'));
        client = await connect(dir);

        assert.deepStrictEqual(output(await check(client, { paths: ['.'] })).files.map(file => file.file), ['src/Chart.vue']);
    });

    it('is listed in allyproof --help', () => {
        assert.match(cli(project({}), ['--help']).stdout, /\n {2}allyproof mcp\b/);
    });
});
