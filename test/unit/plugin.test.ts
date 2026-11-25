import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildNpmManifest, type RootManifest } from '../../scripts/npm-package';

const root = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as RootManifest & { publisher: string };
const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf-8')) as { name: string; version: string };
const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8')) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
};
const skill = fs.readFileSync(path.join(root, 'skills', 'allyproof', 'SKILL.md'), 'utf-8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');

const owner = /github\.com\/([^/]+)\//.exec((manifest.repository as { url: string }).url)?.[1];
const mcpName = `io.github.${owner}/allyproof`;

const expectedMcpServer = {
    command: 'npx',
    args: ['-y', `allyproof@${manifest.version}`, 'mcp']
};

describe('Claude Code plugin and Skill (#101)', () => {
    it('keeps the plugin version and pinned MCP server version in step with package.json', () => {
        assert.strictEqual(plugin.name, 'allyproof');
        assert.strictEqual(plugin.version, manifest.version);
        assert.deepStrictEqual(mcp.mcpServers.allyproof, expectedMcpServer);
    });

    it('instructs the check, fix, re-check loop in the Skill', () => {
        assert.match(skill, /before and after each change/);
        assert.match(skill, /explain_rule/);
        assert.match(skill, /`fix` edits/);
        assert.match(skill, /no new Finding was added/);
        assert.match(skill, /Never add an ignore comment/);
        assert.match(skill, /needs a person/);
        assert.match(skill, /paused or failed Check.*is an error, not a clean pass/);
    });
    it('validates the Skill YAML frontmatter against the Agent Skills specification', () => {
        const match = /^---\n([\s\S]+?)\n---\n/.exec(skill);
        assert.ok(match, 'SKILL.md must start with YAML frontmatter delimited by ---');
        const allowedKeys = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
        const fields = new Map<string, string>();
        for (const line of match[1].split('\n')) {
            if (/^\s+/.test(line) || line.trim() === '') continue;
            const field = /^([a-z][a-z0-9-]*):(?:\s*(.*))?$/.exec(line);
            assert.ok(field, `invalid YAML frontmatter line: ${line}`);
            assert.ok(allowedKeys.has(field[1]), `unsupported Agent Skills frontmatter key: ${field[1]}`);
            fields.set(field[1], (field[2] ?? '').trim());
        }
        const name = fields.get('name') ?? '';
        assert.strictEqual(name, 'allyproof', 'Skill name must match its directory');
        assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        assert.ok(name.length >= 1 && name.length <= 64);
        const description = fields.get('description') ?? '';
        assert.ok(description.length > 0 && description.length <= 1024, 'Skill description must be concise (1-1024 chars)');
    });
});

describe('Cursor plugin bundle, install badges and multi-agent matrix (#111)', () => {
    it('bundles the pinned MCP server, Skill and check-first rule in .cursor-plugin/plugin.json', () => {
        const cursorPluginPath = path.join(root, '.cursor-plugin', 'plugin.json');
        assert.ok(fs.existsSync(cursorPluginPath), '.cursor-plugin/plugin.json should exist');
        const cursorPlugin = JSON.parse(fs.readFileSync(cursorPluginPath, 'utf-8')) as {
            name: string;
            version: string;
            skills: string;
            rules: string;
            mcpServers: Record<string, { command: string; args: string[] }>;
        };

        assert.strictEqual(cursorPlugin.name, 'allyproof');
        assert.strictEqual(cursorPlugin.version, manifest.version);
        assert.deepStrictEqual(cursorPlugin.mcpServers.allyproof, expectedMcpServer);

        const skillPath = path.resolve(root, cursorPlugin.skills);
        assert.strictEqual(skillPath, path.join(root, 'skills', 'allyproof', 'SKILL.md'));
        assert.ok(fs.existsSync(skillPath), 'Cursor plugin skill target should exist');

        const rulePath = path.resolve(root, cursorPlugin.rules);
        assert.ok(fs.existsSync(rulePath), 'Cursor plugin rule target should exist');
        const ruleContent = fs.readFileSync(rulePath, 'utf-8');
        assert.match(ruleContent, /^---\r?\n[\s\S]*?description:[\s\S]*?globs:[\s\S]*?\r?\n---/);
        assert.match(ruleContent, /before and after/i);
        assert.match(ruleContent, /Check/);
    });

    it('includes one-click install badges for VS Code and Cursor in README synced with package.json', () => {
        assert.ok(
            readme.includes(`https://marketplace.visualstudio.com/items?itemName=${manifest.publisher}.${manifest.name}`),
            'README should include VS Code Marketplace install link'
        );

        const vscodeMcpMatch = readme.match(/https:\/\/vscode\.dev\/redirect\/mcp\/install\?name=allyproof&config=([^)\s]+)/);
        assert.ok(vscodeMcpMatch, 'README should include a VS Code one-click MCP install link');
        const vscodeConfig = JSON.parse(decodeURIComponent(vscodeMcpMatch[1])) as { command: string; args: string[] };
        assert.deepStrictEqual(vscodeConfig, expectedMcpServer);

        const cursorMcpMatch = readme.match(/https:\/\/cursor\.com\/en\/install-mcp\?name=allyproof&config=([^)\s]+)/);
        assert.ok(cursorMcpMatch, 'README should include a Cursor one-click MCP install link');
        const cursorConfig = JSON.parse(Buffer.from(decodeURIComponent(cursorMcpMatch[1]), 'base64').toString('utf-8')) as {
            command: string;
            args: string[];
        };
        assert.deepStrictEqual(cursorConfig, expectedMcpServer);
    });

    it('documents local stdio MCP setup for all 8 clients with version parity and no secrets or local paths', () => {
        for (const client of ['Claude Code', 'Codex', 'Cursor', 'Windsurf', 'Cline', 'Roo Code', 'Zed', 'VS Code', 'Gemini CLI']) {
            assert.ok(readme.includes(client), `README does not mention ${client}`);
        }

        const pinnedVersions = [...readme.matchAll(/allyproof@(\d+\.\d+\.\d+)/g)].map(m => m[1]);
        assert.ok(pinnedVersions.length >= 7, 'README should include pinned allyproof@<version> snippets across clients');
        for (const v of pinnedVersions) {
            assert.strictEqual(v, manifest.version, `README has stale version pin allyproof@${v}`);
        }

        const filesToScan = [
            fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf-8'),
            fs.readFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), 'utf-8'),
            fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8'),
            readme
        ];
        for (const content of filesToScan) {
            assert.doesNotMatch(content, /\/Users\/|\/home\/|[A-Z]:\\/);
            assert.doesNotMatch(content, /ghp_|sk-|AIza|AKIA|-----BEGIN/);
        }
    });
});

describe('Official MCP Registry descriptor (#110)', () => {
    it('keeps server.json in step with package.json, valid for the Official MCP Registry, and free of secrets or local paths', () => {
        const serverPath = path.join(root, 'server.json');
        assert.ok(fs.existsSync(serverPath), 'server.json should exist at repo root');
        const raw = fs.readFileSync(serverPath, 'utf-8');
        const server = JSON.parse(raw) as {
            $schema: string;
            name: string;
            description: string;
            version: string;
            websiteUrl: string;
            repository: { url: string; source: string };
            packages: {
                registryType: string;
                registryBaseUrl: string;
                identifier: string;
                version: string;
                transport: { type: string };
                packageArguments: { type: string; value: string }[];
            }[];
        };

        assert.match(server.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
        assert.strictEqual(server.name, mcpName);
        assert.strictEqual(server.version, manifest.version);
        assert.ok(server.description.length > 0 && server.description.length <= 100, 'description must be 1-100 chars');
        assert.deepStrictEqual(server.repository, {
            url: 'https://github.com/NotAisu/Accessibility_Extension',
            source: 'github'
        });
        assert.match(server.websiteUrl, /^https:\/\/github\.com\/NotAisu\/Accessibility_Extension/);

        assert.strictEqual(server.packages.length, 1);
        const [pkg] = server.packages;
        assert.strictEqual(pkg.registryType, 'npm');
        assert.strictEqual(pkg.registryBaseUrl, 'https://registry.npmjs.org');
        assert.strictEqual(pkg.identifier, 'allyproof');
        assert.strictEqual(pkg.version, manifest.version);
        assert.deepStrictEqual(pkg.transport, { type: 'stdio' });
        assert.deepStrictEqual(pkg.packageArguments, [{ type: 'positional', value: 'mcp' }]);

        const npmManifest = buildNpmManifest(manifest);
        assert.strictEqual(npmManifest.mcpName, server.name, 'generated npm package.json mcpName must match server.json name');

        assert.doesNotMatch(raw, /\/Users\/|\/home\/|[A-Z]:\\/);
        assert.doesNotMatch(raw, /ghp_|sk-|AIza|AKIA|-----BEGIN/);
    });

    it('spells the MCP Registry name with the exact casing of the GitHub owner wherever it appears', () => {
        // The registry's GitHub OIDC login is case-sensitive: io.github.notaisu failed the 0.2.0 publish
        for (const file of ['server.json', '.github/workflows/release.yml', 'scripts/npm-package.ts', 'site/llms.txt']) {
            const text = fs.readFileSync(path.join(root, file), 'utf-8');
            const spellings = [...text.matchAll(/io\.github\.([\w-]+)/gi)].map((m) => `io.github.${m[1]}`);
            assert.ok(spellings.length > 0, `${file} should name the registry server`);
            for (const spelling of spellings) {
                assert.strictEqual(spelling, mcpName.split('/')[0], `${file} spells the registry namespace as ${spelling}`);
            }
        }
    });
});
