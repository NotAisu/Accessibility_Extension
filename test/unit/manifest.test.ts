import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');
interface Manifest {
    publisher: string;
    name: string;
    displayName: string;
    license: string;
    pricing: string;
    repository?: { url?: string };
    extensionKind?: string[];
    capabilities?: { untrustedWorkspaces?: { supported: boolean | string; restrictedConfigurations?: string[] } };
    keywords?: string[];
    categories?: string[];
    contributes: {
        commands: { command: string; category: string }[];
        views?: Record<string, { id: string; type?: string }[]>;
        languageModelTools?: { name: string; when?: string }[];
        chatSkills?: { path: string; when?: string }[];
        walkthroughs?: { id: string; steps: { id: string; description: string; media: { markdown?: string } }[] }[];
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

    it('puts every command under the Allyproof category', () => {
        for (const command of manifest.contributes.commands) {
            assert.strictEqual(command.category, 'Allyproof', command.command);
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

    it('runs on the UI side or in the remote workspace', () => {
        assert.deepStrictEqual(manifest.extensionKind, ['ui', 'workspace']);
    });

    it('carries the Marketplace identity', () => {
        assert.strictEqual(manifest.publisher, 'notaisu');
        assert.strictEqual(manifest.name, 'allyproof');
        assert.strictEqual(manifest.displayName, 'Allyproof – WCAG 2.2 Accessibility Checker');
        assert.strictEqual(manifest.license, 'MIT');
        assert.strictEqual(manifest.pricing, 'Free');
        assert.ok(manifest.repository?.url, 'repository');
        assert.ok(manifest.keywords?.length, 'keywords');
        assert.ok(manifest.categories?.length, 'categories');
        assert.ok(fs.existsSync(path.join(root, 'LICENSE')), 'LICENSE file');
    });
});
