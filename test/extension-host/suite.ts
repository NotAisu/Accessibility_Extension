import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';
import type { TestingApi } from '../../src/extension';

// Runs inside the extension host against the packaged extension; ALLYPROOF_TRUST says how the runner opened the
// workspace, so the same suite covers trusted and Restricted Mode
const trusted = process.env.ALLYPROOF_TRUST === 'trusted';

suite(`Extension host (${trusted ? 'trusted' : 'untrusted'} workspace)`, () => {
    let api: TestingApi;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<TestingApi>('notaisu.allyproof');
        assert.ok(extension, 'Allyproof is not installed');
        api = await extension.activate();
        assert.ok(api, 'Allyproof exposes no testing API in the extension host');
        assert.strictEqual(vscode.workspace.isTrusted, trusted);
    });

    test('opening a file shows diagnostics', async () => {
        const document = await open('index.html');
        const diagnostics = await diagnosticsOf(document.uri, found => found.some(d => code(d) === 'html-has-lang'));
        assert.ok(diagnostics.some(d => code(d) === 'image-alt'), messages(diagnostics));
        assert.ok(diagnostics.every(d => d.source === 'Allyproof'));
    });

    test('the Findings tree lists the file with accessible labels', async () => {
        const document = await open('index.html');
        await diagnosticsOf(document.uri, found => found.length > 0);
        const file = api.findings.getChildren().find(node => api.findings.getTreeItem(node).label === 'index.html');
        assert.ok(file, 'index.html is not in the Findings tree');
        const fileItem = api.findings.getTreeItem(file);
        assert.match(String(fileItem.accessibilityInformation?.label), /^index\.html, \d+ Findings/);
        const labels = api.findings.getChildren(file).flatMap(node => [node, ...api.findings.getChildren(node)])
            .map(node => api.findings.getTreeItem(node).accessibilityInformation?.label ?? '');
        assert.ok(labels.some(label => /^Check Finding: Images must have alternative text, line 5$/.test(label)), labels.join('\n'));
        assert.ok(labels.some(label => label.startsWith('WCAG 1.1.1 Non-text Content, ')), labels.join('\n'));
    });

    test('the status bar summary has an accessible label', async () => {
        const document = await open('index.html');
        await diagnosticsOf(document.uri, found => found.length > 0);
        await until(() => api.findingsStatus.text !== '', 'the status bar summary never showed');
        assert.match(String(api.findingsStatus.accessibilityInformation?.label), /^Accessibility: \d+ Findings/);
    });

    test('a quick fix can be applied', async () => {
        const document = await open('fixable.html');
        const [lang] = await diagnosticsOf(document.uri, found => found.some(d => code(d) === 'html-has-lang'))
            .then(found => found.filter(d => code(d) === 'html-has-lang'));
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider', document.uri, lang.range, vscode.CodeActionKind.QuickFix.value);
        const fix = actions.find(action => action.title === 'Fix this Finding (html-has-lang)');
        assert.ok(fix?.edit, actions.map(action => action.title).join('\n'));
        assert.ok(fix.isPreferred);
        assert.ok(await vscode.workspace.applyEdit(fix.edit));
        assert.match(document.getText(), /<html lang="en">/);
        await document.save();
        await diagnosticsOf(document.uri, found => found.length > 0 && !found.some(d => code(d) === 'html-has-lang'));
    });

    test(trusted ? 'AI Review contacts the local model in a trusted workspace' : 'AI Review is disabled in an untrusted workspace', async () => {
        // A local OpenAI-compatible server that lists no models, so a trusted review stops before the provider notice
        const requests: string[] = [];
        const server = http.createServer((request, response) => {
            requests.push(`${request.method} ${request.url}`);
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [] }));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const settings = vscode.workspace.getConfiguration('allyproof');
        try {
            // User settings: in Restricted Mode the workspace's own provider settings are ignored by design
            await settings.update('aiReview.localEndpoint', `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, vscode.ConfigurationTarget.Global);
            await settings.update('aiReview.provider', 'local', vscode.ConfigurationTarget.Global);
            await open('index.html');
            await vscode.commands.executeCommand('allyproof.startAIReview');

            if (trusted) {
                assert.deepStrictEqual(requests, ['GET /v1/models']);
            } else {
                assert.deepStrictEqual(requests, []);
                await until(() => api.aiReviewStatus.text.includes('AI Review disabled'), `status bar shows "${api.aiReviewStatus.text}"`);
                assert.strictEqual(api.aiReviewStatus.accessibilityInformation?.label, 'AI Review disabled. Trust this workspace to enable AI Review.');
            }
        } finally {
            await settings.update('aiReview.provider', undefined, vscode.ConfigurationTarget.Global);
            await settings.update('aiReview.localEndpoint', undefined, vscode.ConfigurationTarget.Global);
            server.close();
        }
    });
});

async function open(name: string): Promise<vscode.TextDocument> {
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, name));
    await vscode.window.showTextDocument(document);
    return document;
}

// The Check runs in a worker; its first run also loads the engine chunk
async function diagnosticsOf(uri: vscode.Uri, done: (found: vscode.Diagnostic[]) => boolean): Promise<vscode.Diagnostic[]> {
    await until(() => done(vscode.languages.getDiagnostics(uri)), `diagnostics never matched: ${messages(vscode.languages.getDiagnostics(uri))}`);
    return vscode.languages.getDiagnostics(uri);
}

async function until(condition: () => boolean, failure: string, timeout = 20000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(failure);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

function code(diagnostic: vscode.Diagnostic): string {
    return typeof diagnostic.code === 'object' ? String(diagnostic.code.value) : String(diagnostic.code);
}

function messages(diagnostics: vscode.Diagnostic[]): string {
    return diagnostics.map(d => `${code(d)}: ${d.message}`).join('\n') || 'none';
}
