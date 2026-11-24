import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildNpmManifest } from '../../scripts/npm-package';

const root = path.join(__dirname, '..', '..');
interface Manifest {
    publisher: string;
    name: string;
    version: string;
    displayName: string;
    license: string;
    pricing: string;
    homepage?: string;
    repository?: { url?: string };
    extensionKind?: string[];
    capabilities?: { untrustedWorkspaces?: { supported: boolean | string; restrictedConfigurations?: string[] } };
    keywords?: string[];
    categories?: string[];
    contributes: {
        commands: { command: string; category: string }[];
        viewsContainers?: { activitybar?: { id: string; title: string; icon: string }[] };
        viewsWelcome?: { view: string; contents: string }[];
        views?: Record<string, { id: string; type?: string }[]>;
        languageModelTools?: { name: string; when?: string }[];
        chatSkills?: { path: string; when?: string }[];
        walkthroughs?: { id: string; steps: { id: string; description: string; media: { markdown?: string }; when?: string }[] }[];
        configuration?: { properties: Record<string, { type: string; scope?: string; enum?: string[]; default?: unknown }> };
    };
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as Manifest;

function registeredCommands(): string[] {
    const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf-8');
    const ids = [...source.matchAll(/register(?:TextEditor)?Command\(\s*'([^']+)'/g)].map(m => m[1]);
    return ids.sort();
}

function sourceOf(file: string): string {
    return fs.readFileSync(path.join(root, 'src', file), 'utf-8');
}

describe('manifest', () => {
    it('declares exactly the commands the extension registers', () => {
        const declared = manifest.contributes.commands.map(c => c.command).sort();
        assert.ok(declared.length > 0);
        assert.deepStrictEqual(declared, registeredCommands());
    });

    it('declares exactly the language model tools the extension registers', () => {
        const declared = (manifest.contributes.languageModelTools ?? []).map(t => t.name).sort();
        const registered = [...sourceOf('extension.ts').matchAll(/registerTool\(\s*'([^']+)'/g)].map(m => m[1]).sort();
        assert.deepStrictEqual(declared, ['a11y_check']);
        assert.deepStrictEqual(registered, declared);
    });

    it('contributes the Skill the AI Review loads', () => {
        const [skill, ...others] = manifest.contributes.chatSkills ?? [];
        assert.strictEqual(others.length, 0);
        assert.strictEqual(path.normalize(skill.path), path.join('skills', 'allyproof', 'SKILL.md'));
        const name = /^name: (.+)$/m.exec(fs.readFileSync(path.join(root, skill.path), 'utf-8'))?.[1];
        assert.strictEqual(name, path.basename(path.dirname(skill.path)), 'the Skill name must match its directory');
        assert.match(sourceOf('ai-review-ui.ts'), /SKILL_PATH = \['skills', 'allyproof', 'SKILL\.md'\]/);
    });

    it('shows AI contributions only where the language model API exists', () => {
        const ai = [...(manifest.contributes.languageModelTools ?? []), ...(manifest.contributes.chatSkills ?? [])];
        for (const contribution of ai) assert.strictEqual(contribution.when, 'allyproof.aiAvailable');
    });

    it('offers fixing on save as a setting that is off by default', () => {
        const setting = manifest.contributes.configuration?.properties['allyproof.check.fixOnSave'];
        assert.deepStrictEqual(setting && { type: setting.type, default: setting.default }, { type: 'boolean', default: false });
        assert.match(sourceOf('check-fixes.ts'), /'check\.fixOnSave'/);
    });

    it('reads the rule settings per resource, so each folder of a multi-root workspace has its own', () => {
        assert.strictEqual(manifest.contributes.configuration?.properties['allyproof.rules'].scope, 'resource');
        assert.match(sourceOf('check-diagnostics.ts'), /getConfiguration\('allyproof', scope\)\.get<Record<string, RuleSetting>>\('rules'/);
    });

    it('walks new users through the Check, AI Review, the Skill and configuring rules', () => {
        const [walkthrough, ...others] = manifest.contributes.walkthroughs ?? [];
        assert.strictEqual(others.length, 0);
        assert.deepStrictEqual(walkthrough.steps.map(step => step.id), ['check', 'aiReview', 'skill', 'configure']);
        const views = Object.values(manifest.contributes.views ?? {}).flat().map(view => `${view.id}.focus`);
        const commands = [...manifest.contributes.commands.map(c => c.command), ...views];
        const settings = Object.keys(manifest.contributes.configuration?.properties ?? {});
        const shipped = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf-8');
        for (const step of walkthrough.steps) {
            // allyproof.aiAvailable is set only after activation, so a when clause would hide a step on a fresh install
            assert.strictEqual(step.when, undefined, step.id);
            const markdown = step.media.markdown ?? '';
            assert.ok(fs.existsSync(path.join(root, markdown)), markdown);
            assert.ok(shipped.includes(`!${path.dirname(markdown)}/**`), `${markdown} ships in the VSIX`);
            const text = step.description + fs.readFileSync(path.join(root, markdown), 'utf-8');
            for (const [, id] of text.matchAll(/command:(allyproof\.[\w.]+)/g)) assert.ok(commands.includes(id), id);
            for (const [, key] of text.matchAll(/(allyproof\.[\w.]+\w)/g)) {
                assert.ok(commands.includes(key) || settings.includes(key), key);
            }
        }
    });

    it('shows Findings in a native tree view, with no webviews anywhere', () => {
        const views = Object.values(manifest.contributes.views ?? {}).flat();
        assert.ok(views.some(view => view.id === 'allyproof.findings'), 'Findings tree');
        assert.ok(views.every(view => view.type !== 'webview'), 'no webview views');
        for (const file of fs.readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf-8' })) {
            if (!file.endsWith('.ts')) continue;
            assert.doesNotMatch(fs.readFileSync(path.join(root, 'src', file), 'utf-8'), /createWebviewPanel|registerWebview/, file);
        }
    });

    it('gives the Findings tree its own Activity Bar item, with an icon shipped in the VSIX', () => {
        const container = manifest.contributes.viewsContainers?.activitybar?.find(c => c.id === 'allyproof');
        assert.ok(container, 'Allyproof Activity Bar container');
        assert.ok(manifest.contributes.views?.allyproof?.some(view => view.id === 'allyproof.findings'), 'Findings tree in the container');
        assert.ok(fs.existsSync(path.join(root, container.icon)), container.icon);
        assert.ok(fs.readFileSync(path.join(root, '.vscodeignore'), 'utf-8').includes(`!${container.icon}`), `${container.icon} ships in the VSIX`);
        const walkthrough = `${manifest.publisher}.${manifest.name}#${manifest.contributes.walkthroughs?.[0].id}`;
        const welcome = manifest.contributes.viewsWelcome?.find(entry => entry.view === 'allyproof.findings')?.contents ?? '';
        assert.ok(welcome.includes(`openWalkthrough?${encodeURIComponent(JSON.stringify(walkthrough))}`), 'empty view links the walkthrough');
    });

    it('lets AI Review use Copilot or a local model, with endpoint and model out of reach of untrusted workspaces', () => {
        const settings = manifest.contributes.configuration?.properties ?? {};
        assert.deepStrictEqual(settings['allyproof.aiReview.provider'].enum, ['copilot', 'local']);
        assert.strictEqual(settings['allyproof.aiReview.provider'].default, 'copilot');
        // The provider too, so a workspace cannot switch a local model user to Copilot
        const restricted = ['allyproof.aiReview.provider', 'allyproof.aiReview.localEndpoint', 'allyproof.aiReview.localModel'];
        for (const key of restricted) assert.ok(settings[key], key);
        const trust = manifest.capabilities?.untrustedWorkspaces;
        assert.strictEqual(trust?.supported, 'limited');
        assert.deepStrictEqual(trust.restrictedConfigurations, restricted);
    });

    it('generates an npm CLI manifest with discovery keywords and homepage', () => {
        const npmManifest = buildNpmManifest(manifest);
        const requiredKeywords = [
            'accessibility', 'a11y', 'wcag', 'wcag-2-2',
            'mcp', 'mcp-server', 'agent-skills', 'linter',
            'html', 'react', 'vue', 'svelte', 'angular', 'astro'
        ];
        for (const keyword of requiredKeywords) {
            assert.ok(npmManifest.keywords.includes(keyword), `missing npm keyword: ${keyword}`);
        }
        assert.match(npmManifest.homepage, /^https:\/\/github\.com\/NotAisu\/Accessibility_Extension/);
    });

    it('gives the GitHub Action valid Marketplace branding', () => {
        const action = fs.readFileSync(path.join(root, 'action.yml'), 'utf-8');
        const branding = /^branding:\n((?: {2}.+\n)+)/m.exec(action)?.[1] ?? '';
        const icon = /^ {2}icon:\s*([a-z0-9-]+)\s*$/m.exec(branding)?.[1];
        const color = /^ {2}color:\s*([a-z-]+)\s*$/m.exec(branding)?.[1];
        const allowedColors = ['white', 'yellow', 'blue', 'green', 'orange', 'red', 'purple', 'gray-dark'];
        assert.ok(icon, 'action.yml branding.icon must be set');
        assert.ok(color && allowedColors.includes(color), `action.yml branding.color must be a Marketplace color, got ${String(color)}`);
    });

    it('enforces zero-leak packaging for npm, VSIX, manifests and scripts', () => {
        const sensitive = [/^\.env(?:\.|$)/i, /^AGENTS\.md$/i, /^CLAUDE\.md$/i, /^GLOSSARY\.md$/i, /^docs(?:\/|$)/i, /(?:^|\/)(?:\.npmrc|credentials|secret|.*\.(?:pem|key))(?:\.|$|\/)/i];
        const broad = /^(?:\*\*?|\.?\/?)$/;

        const npmManifest = buildNpmManifest(manifest);
        assert.ok(npmManifest.files.length > 0, 'npm package must declare an explicit files allowlist');
        for (const entry of npmManifest.files) {
            assert.doesNotMatch(entry, broad, `npm files entry too broad: ${entry}`);
            for (const pattern of sensitive) {
                assert.doesNotMatch(entry, pattern, `npm files entry must not ship sensitive file: ${entry}`);
            }
        }

        const vscodeignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf-8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));
        assert.strictEqual(vscodeignore[0], '**', '.vscodeignore must start with default-deny **');
        const vsixAllowed = vscodeignore.filter(line => line.startsWith('!')).map(line => line.slice(1));
        assert.ok(vsixAllowed.length > 0, '.vscodeignore must explicitly allowlist shipped files');
        for (const entry of vsixAllowed) {
            assert.doesNotMatch(entry, broad, `.vscodeignore allowlist entry too broad: ${entry}`);
            for (const pattern of sensitive) {
                assert.doesNotMatch(entry, pattern, `.vscodeignore must not allow sensitive file: ${entry}`);
            }
        }

        const localPathPattern = /(?:\/Users\/|\/home\/|C:\\Users\\)/i;
        const scriptFiles = fs.readdirSync(path.join(root, 'scripts')).map(file => path.join('scripts', file));
        const publishedFiles = [
            'package.json',
            'server.json',
            '.claude-plugin/plugin.json',
            '.mcp.json',
            'action.yml',
            'skills/allyproof/SKILL.md',
            'README.md',
            ...scriptFiles
        ];
        for (const rel of publishedFiles) {
            const content = fs.readFileSync(path.join(root, rel), 'utf-8');
            assert.doesNotMatch(content, localPathPattern, `hardcoded local user path in ${rel}`);
        }
        assert.doesNotMatch(JSON.stringify(npmManifest), localPathPattern, 'hardcoded local user path in generated npm manifest');
    });
});
