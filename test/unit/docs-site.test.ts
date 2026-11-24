import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import proofStatus from '../../src/core/proof-status.json';
import { buildNpmManifest } from '../../scripts/npm-package';

const root = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
    name: string;
    version: string;
    publisher: string;
    license: string;
    homepage?: string;
    repository?: unknown;
};

const siteDir = path.join(root, 'site');
const indexHtmlPath = path.join(siteDir, 'index.html');
const llmsTxtPath = path.join(siteDir, 'llms.txt');
const pagesWorkflowPath = path.join(root, '.github', 'workflows', 'pages.yml');

function provenRuleCount(): number {
    let count = 0;
    for (const langs of Object.values(proofStatus.rules)) {
        for (const entry of Object.values(langs)) {
            if (entry.proven) count++;
        }
    }
    return count;
}

describe('Static documentation site, llms.txt and Pages workflow (#112)', () => {
    it('ships site/index.html and site/llms.txt synced with package.json version', () => {
        assert.ok(fs.existsSync(indexHtmlPath), 'site/index.html must exist');
        assert.ok(fs.existsSync(llmsTxtPath), 'site/llms.txt must exist');

        for (const [label, filePath] of [['site/index.html', indexHtmlPath], ['site/llms.txt', llmsTxtPath]] as const) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const pins = [...content.matchAll(/allyproof@(\d+\.\d+\.\d+)/g)].map(m => m[1]);
            assert.ok(pins.length > 0, `${label} must pin allyproof@<version>`);
            for (const version of pins) {
                assert.strictEqual(version, manifest.version, `${label} has stale version pin allyproof@${version}`);
            }
        }
    });

    it('documents all 8 required surfaces and privacy guarantees in site/llms.txt', () => {
        const llms = fs.readFileSync(llmsTxtPath, 'utf-8');

        // 1. VS Code Marketplace
        assert.ok(
            llms.includes(`https://marketplace.visualstudio.com/items?itemName=${manifest.publisher}.${manifest.name}`),
            'site/llms.txt must include VS Code Marketplace URL'
        );
        // 2. Open VSX
        assert.ok(
            llms.includes(`https://open-vsx.org/extension/${manifest.publisher}/${manifest.name}`),
            'site/llms.txt must include Open VSX URL'
        );
        // 3. npm CLI
        assert.ok(llms.includes('npx allyproof check'), 'site/llms.txt must include npm CLI install/run command');
        // 4. stdio MCP + Official MCP Registry
        assert.ok(
            llms.includes(`npx -y allyproof@${manifest.version} mcp`),
            'site/llms.txt must include pinned stdio MCP command'
        );
        assert.ok(
            llms.includes('io.github.NotAisu/allyproof'),
            'site/llms.txt must include Official MCP Registry identifier'
        );
        // 5. Agent Skill + optional Browser Audit Skill
        assert.ok(llms.includes('skills/allyproof/SKILL.md'), 'site/llms.txt must include Agent Skill path');
        assert.ok(
            llms.includes('skills/allyproof-browser-audit/SKILL.md'),
            'site/llms.txt must include optional Browser Audit Skill path'
        );
        // 6. Claude Code plugin
        assert.ok(llms.includes('.claude-plugin/plugin.json'), 'site/llms.txt must document Claude Code plugin');
        // 7. Cursor plugin
        assert.ok(llms.includes('.cursor-plugin/plugin.json'), 'site/llms.txt must document Cursor plugin');
        // 8. GitHub Action
        assert.ok(llms.includes('NotAisu/Accessibility_Extension'), 'site/llms.txt must document GitHub Action');

        // Local/offline/no-telemetry and zero workspace code execution guarantees
        assert.match(llms, /offline/i);
        assert.match(llms, /no telemetry|zero[- ]telemetry/i);
        assert.match(llms, /never execut|zero workspace.*execut|parsed, never run/i);
    });

    it('keeps site/index.html strictly static with zero scripts, zero trackers/CDNs, and links to llms.txt', () => {
        const html = fs.readFileSync(indexHtmlPath, 'utf-8');

        assert.doesNotMatch(html, /<script\b/i, 'site/index.html must contain zero <script> tags');
        assert.doesNotMatch(
            html,
            /googletagmanager|google-analytics|gtag|plausible|fathom|posthog|segment\.com|mixpanel|clarity\.ms|cloudflareinsights|fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare/i,
            'site/index.html must contain zero external trackers, analytics, or CDNs'
        );
        assert.doesNotMatch(
            html,
            /<(?:link|img|iframe|object|embed)\b[^>]*(?:href|src)=["']https?:\/\//i,
            'site/index.html must not load external subresources'
        );
        assert.ok(html.includes('href="./llms.txt"'), 'site/index.html must link to ./llms.txt');
        assert.ok(html.includes('npm run eval:agent'), 'site/index.html must document reproducible eval:agent');
        assert.ok(
            html.includes(`${provenRuleCount()} Proven rules`),
            `site/index.html must match proof-status.json (${provenRuleCount()} Proven rules)`
        );
    });

    it('passes Allyproof static HTML Check on site/index.html with zero Findings', async () => {
        const html = fs.readFileSync(indexHtmlPath, 'utf-8');
        const result = await analyse({ languageId: 'html', text: html });
        assert.deepStrictEqual(
            result.findings,
            [],
            `site/index.html must have 0 Allyproof Findings, got: ${result.findings.map(f => `${f.ruleId}: ${f.message}`).join('; ')}`
        );
    });

    it('contains zero secrets and zero local filesystem paths in site/index.html and site/llms.txt', () => {
        const secretPattern = /AIza|ghp_|gho_|github_pat_|sk-|AKIA|-----BEGIN/;
        const localPathPattern = /\/Users\/|\/home\/|[A-Z]:\\/;

        for (const [label, filePath] of [['site/index.html', indexHtmlPath], ['site/llms.txt', llmsTxtPath]] as const) {
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.doesNotMatch(content, secretPattern, `${label} must not contain secrets`);
            assert.doesNotMatch(content, localPathPattern, `${label} must not contain local filesystem paths`);
        }
    });

    it('excludes site/ from the packaged VSIX (.vscodeignore) and npm tarball', () => {
        const vscodeignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf-8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));

        assert.strictEqual(vscodeignore[0], '**', '.vscodeignore must start with default-deny **');
        assert.ok(
            !vscodeignore.some(line => /^!site(?:\/|$)/.test(line)),
            '.vscodeignore must not allowlist site/'
        );

        const npmManifest = buildNpmManifest(manifest);
        assert.ok(
            !npmManifest.files.some(entry => /^site(?:\/|$)/.test(entry)),
            'npm package files allowlist must exclude site/'
        );
    });

    it('provides a GitHub Pages workflow deploying ./site', () => {
        assert.ok(fs.existsSync(pagesWorkflowPath), '.github/workflows/pages.yml must exist');
        const workflow = fs.readFileSync(pagesWorkflowPath, 'utf-8');
        assert.match(workflow, /actions\/configure-pages@/);
        assert.match(workflow, /actions\/upload-pages-artifact@/);
        assert.match(workflow, /actions\/deploy-pages@/);
        assert.match(workflow, /path:\s*['"]?\.\/site['"]?/);
    });
});
