import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');

// Shapes of real credentials, strict enough that fixture markup and prose never match.
// Field fixtures copied from other projects once brought a demo Google API key along.
const credentials: [string, RegExp][] = [
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{22,}/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['OpenAI or Anthropic key', /\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{32,}/],
    ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
];

describe('Tracked files carry no credentials', () => {
    it('finds no credential in any tracked text file, fixtures included', () => {
        const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf-8' }).split('\0').filter(Boolean);
        const hits: string[] = [];
        for (const file of files) {
            const full = path.join(root, file);
            if (!fs.existsSync(full)) continue;
            const buffer = fs.readFileSync(full);
            if (buffer.includes(0)) continue; // binary
            const text = buffer.toString('utf-8');
            for (const [kind, pattern] of credentials) {
                if (pattern.test(text)) hits.push(`${file}: ${kind}`);
            }
        }
        assert.deepStrictEqual(hits, [], 'Remove the credential, or replace it with an obvious placeholder in the fixture');
    });
});
