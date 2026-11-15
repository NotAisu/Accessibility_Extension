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
    keywords?: string[];
    categories?: string[];
    contributes: {
        commands: { command: string; category: string }[];
        views?: Record<string, { id: string; type?: string }[]>;
    };
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as Manifest;

function registeredCommands(): string[] {
    const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf-8');
    const ids = [...source.matchAll(/register(?:TextEditor)?Command\(\s*'([^']+)'/g)].map(m => m[1]);
    return ids.sort();
}

describe('manifest', () => {
    it('declares exactly the commands the extension registers', () => {
        const declared = manifest.contributes.commands.map(c => c.command).sort();
        assert.ok(declared.length > 0);
        assert.deepStrictEqual(declared, registeredCommands());
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
