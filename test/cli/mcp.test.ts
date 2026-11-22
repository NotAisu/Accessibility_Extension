import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'url';
import type { CheckOutput } from '../../src/cli/output';

// The packaged MCP server as an MCP client runs it: `allyproof mcp` of the bundle ALLYPROOF_CLI names, over stdio
const CLI = path.resolve(process.env.ALLYPROOF_CLI ?? path.join(__dirname, '..', '..', 'dist', 'cli.mjs'));

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

    it('is listed in allyproof --help', () => {
        assert.match(cli(project({}), ['--help']).stdout, /\n {2}allyproof mcp\b/);
    });
});
