import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version: string };
const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf-8')) as { name: string; version: string };
const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8')) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
};
const skill = fs.readFileSync(path.join(root, 'skills', 'allyproof', 'SKILL.md'), 'utf-8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');

describe('Claude Code plugin and Skill (#101)', () => {
    it('keeps the plugin version and pinned MCP server version in step with package.json', () => {
        assert.strictEqual(plugin.name, 'allyproof');
        assert.strictEqual(plugin.version, manifest.version);
        assert.deepStrictEqual(mcp.mcpServers.allyproof, {
            command: 'npx',
            args: ['-y', `allyproof@${manifest.version}`, 'mcp']
        });
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

    it('documents MCP setup for Claude Code, Codex, Cursor, Zed and VS Code in README', () => {
        for (const client of ['Claude Code', 'Codex', 'Cursor', 'Zed', 'VS Code']) {
            assert.ok(readme.includes(client), `README does not mention ${client}`);
        }
        assert.ok(readme.includes(`allyproof@${manifest.version}`), 'README MCP config should match package.json version');
    });
});
