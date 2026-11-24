import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'url';
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

// A client that declares `roots` answers the server's roots/list with them; `roots.dirs` can change while connected
async function connect(cwd: string, roots?: { dirs: string[] }): Promise<Client> {
    const client = new Client({ name: 'allyproof-test', version: '1.0.0' }, roots ? { capabilities: { roots: { listChanged: true } } } : undefined);
    if (roots) {
        client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: roots.dirs.map(dir => ({ uri: pathToFileURL(dir).href, name: path.basename(dir) })) }));
    }
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

    it('offers read-only check, explain_rule and list_rules tools', async () => {
        client = await connect(project({}));
        const { tools } = await client.listTools();

        for (const name of ['check', 'explain_rule', 'list_rules']) {
            const tool = tools.find(t => t.name === name);
            assert.ok(tool, `${name} is not in ${tools.map(t => t.name).join(', ')}`);
            assert.strictEqual(tool.annotations?.readOnlyHint, true, name);
        }
    });

    it('lists the rules as allyproof rules --format json does', async () => {
        const dir = project({});
        const expected: unknown = JSON.parse(cli(dir, ['rules', '--format', 'json']).stdout);
        client = await connect(dir);

        const result = await client.callTool({ name: 'list_rules', arguments: {} }) as ToolResult;
        assert.ok(!result.isError, result.content[0]?.text);
        assert.deepStrictEqual(JSON.parse(result.content[0].text), expected);
    });

    it('explains a rule as allyproof explain does, with its proof status', async () => {
        const dir = project({});
        client = await connect(dir);

        for (const [args, flags] of [[{ ruleId: 'vuejs-accessibility/alt-text', languageId: 'vue' }, ['--language', 'vue']], [{ ruleId: 'image-alt' }, []]] as const) {
            const expected = cli(dir, ['explain', args.ruleId, ...flags]).stdout;
            const result = await client.callTool({ name: 'explain_rule', arguments: args }) as ToolResult;
            assert.ok(!result.isError, result.content[0]?.text);
            assert.strictEqual(result.content[0].text, expected);
            assert.match(result.content[0].text, /\nProof: /);
        }
    });

    it('reports an unknown rule id as a tool error', async () => {
        client = await connect(project({}));

        const result = await client.callTool({ name: 'explain_rule', arguments: { ruleId: 'no-such-rule' } }) as ToolResult;
        assert.strictEqual(result.isError, true);
        assert.match(result.content[0].text, /No rule no-such-rule/);
    });

    it('offers every rule\'s docs as a resource that reads as allyproof explain', async () => {
        const dir = project({});
        const ruleIds = (JSON.parse(cli(dir, ['rules', '--format', 'json']).stdout) as { rules: { ruleId: string }[] }).rules.map(rule => rule.ruleId);
        client = await connect(dir);

        const { resources } = await client.listResources();
        assert.deepStrictEqual(resources.map(r => r.uri).sort(), ruleIds.map(id => `allyproof://rules/${id}`).sort());
        for (const id of ruleIds.filter((_, i) => i % 10 === 0)) {
            const { contents } = await client.readResource({ uri: `allyproof://rules/${id}` });
            assert.strictEqual((contents[0] as { text: string }).text, cli(dir, ['explain', id]).stdout, id);
        }
        for (const { uri } of resources) {
            const { contents } = await client.readResource({ uri });
            assert.match((contents[0] as { text: string }).text, /\nHow to fix: /, uri);
        }
    });

    it('offers the Allyproof Skill as the allyproof_review prompt', async () => {
        client = await connect(project({}));

        const { prompts } = await client.listPrompts();
        assert.ok(prompts.some(p => p.name === 'allyproof_review'), prompts.map(p => p.name).join(', '));
        const { messages } = await client.getPrompt({ name: 'allyproof_review' });
        const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'allyproof', 'SKILL.md'), 'utf-8');
        assert.deepStrictEqual(messages, [{ role: 'user', content: { type: 'text', text: skill } }]);
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

    it('checks only files inside the roots the client declares, not the working directory', async () => {
        const outside = project({ 'Secret.vue': FAILING });
        const root = project({ 'src/Chart.vue': FAILING });
        fs.symlinkSync(path.join(outside, 'Secret.vue'), path.join(root, 'src', 'Link.vue'));
        client = await connect(outside, { dirs: [root] });

        assert.strictEqual(output(await check(client, { paths: ['src/Chart.vue'] })).files[0].file, 'src/Chart.vue');
        assert.strictEqual(output(await check(client, { paths: [path.join(root, 'src', 'Chart.vue')] })).summary.findings, 1);
        for (const args of [{ paths: ['../' + path.basename(outside) + '/Secret.vue'] }, { paths: [path.join(outside, 'Secret.vue')] }, { paths: ['src/Link.vue'] }]) {
            const result = await check(client, args);
            assert.strictEqual(result.isError, true, JSON.stringify(args));
            assert.match(result.content[0].text, /outside the project/);
        }
    });

    it('follows the client\'s root list changes', async () => {
        const first = project({ 'src/Chart.vue': FAILING });
        const second = project({ 'src/Map.vue': FAILING });
        const roots = { dirs: [first] };
        client = await connect(first, roots);
        assert.strictEqual((await check(client, { paths: [path.join(second, 'src', 'Map.vue')] })).isError, true);

        roots.dirs = [second];
        await client.sendRootsListChanged();

        assert.strictEqual(output(await check(client, { paths: ['src/Map.vue'] })).summary.findings, 1);
        assert.strictEqual((await check(client, { paths: [path.join(first, 'src', 'Chart.vue')] })).isError, true);
    });

    it('without roots checks the project allyproof check would, from a subfolder too', async () => {
        const settings = '{ "allyproof.rules": { "vuejs-accessibility/alt-text": "off" } }\n';
        const dir = project({ 'src/Chart.vue': FAILING, '.vscode/settings.json': settings });
        spawnSync('git', ['init', '-q'], { cwd: dir });
        const expected = JSON.parse(cli(path.join(dir, 'src'), ['check', 'Chart.vue', '--format', 'json']).stdout) as CheckOutput;
        client = await connect(path.join(dir, 'src'));

        assert.deepStrictEqual(expected.files.map(file => file.file), ['src/Chart.vue']);
        assert.deepStrictEqual(output(await check(client, { paths: ['src/Chart.vue'] })), expected);
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
