// npm run bump -- <version>: moves every release pin from the current package.json version to <version>.
// The version-sync tests in test/unit/plugin.test.ts and docs-site.test.ts fail on any pin this misses.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..');
const pinned = ['.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.mcp.json', 'server.json', 'README.md', 'site/index.html', 'site/llms.txt'];

const cursorConfig = (version: string): string =>
    Buffer.from(JSON.stringify({ command: 'npx', args: ['-y', `allyproof@${version}`, 'mcp'] })).toString('base64');

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
    console.error('Usage: npm run bump -- <major.minor.patch>');
    process.exit(1);
}
const current = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version: string }).version;
if (current === next) {
    console.error(`Already at ${next}`);
    process.exit(1);
}

for (const file of pinned) {
    const full = path.join(root, file);
    const before = fs.readFileSync(full, 'utf-8');
    // The Cursor install badge carries the MCP config as base64, which a plain version replace cannot see
    const after = before.split(cursorConfig(current)).join(cursorConfig(next)).split(current).join(next);
    fs.writeFileSync(full, after);
    console.log(`${before === after ? 'unchanged' : 'updated  '} ${file}`);
}
execFileSync('npm', ['version', next, '--no-git-tag-version'], { cwd: root, stdio: 'inherit' });
console.log(`Bumped ${current} → ${next}. Add a "## ${next}" section to CHANGELOG.md, then run npm run verify.`);
