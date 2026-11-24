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

    it('documents MCP setup for Claude Code, Codex, Cursor, Zed and VS Code in README', () => {
        for (const client of ['Claude Code', 'Codex', 'Cursor', 'Zed', 'VS Code']) {
            assert.ok(readme.includes(client), `README does not mention ${client}`);
        }
        assert.ok(readme.includes(`allyproof@${manifest.version}`), 'README MCP config should match package.json version');
    });
});
