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
        const extension = vscode.extensions.getExtension<TestingApi>('aisu.allyproof');
        assert.ok(extension, 'Allyproof is not installed');
        api = await extension.activate();
        assert.ok(api, 'Allyproof exposes no testing API in the extension host');
        assert.strictEqual(vscode.workspace.isTrusted, trusted);
    });

    test('opening a file shows diagnostics', async () => {
        const document = await open('index.html');
        const diagnostics = await diagnosticsOf(document.uri, found => found.some(d => code(d) === 'image-alt'));
        assert.ok(diagnostics.some(d => code(d) === 'image-alt'), messages(diagnostics));
        assert.ok(diagnostics.every(d => d.source === 'Allyproof'));
    });

    test('the Findings tree lists the file with accessible labels', async () => {
        const document = await open('index.html');
        await diagnosticsOf(document.uri, found => found.length > 0);
        const file = api.findings.getChildren().find(node => api.findings.getTreeItem(node).label === 'index.html');
        assert.ok(file, 'index.html is not in the Findings tree');
        const fileItem = api.findings.getTreeItem(file);
        assert.match(String(fileItem.accessibilityInformation?.label), /^index\.html, [1-9]\d* Findings?/);
        const labels = api.findings.getChildren(file).flatMap(node => [node, ...api.findings.getChildren(node)])
            .map(node => api.findings.getTreeItem(node).accessibilityInformation?.label ?? '');
        assert.ok(labels.some(label => /^Check Finding: Images must have alternative text, line 5$/.test(label)), labels.join('\n'));
        assert.ok(labels.some(label => label.startsWith('WCAG 1.1.1 Non-text Content, ')), labels.join('\n'));
    });

    test('the status bar summary has an accessible label', async () => {
        const document = await open('index.html');
        await diagnosticsOf(document.uri, found => found.length > 0);
        await until(() => api.findingsStatus.text !== '', 'the status bar summary never showed');
        assert.match(String(api.findingsStatus.accessibilityInformation?.label), /^Accessibility: [1-9]\d* Findings?/);
    });

    test('a quick fix can be applied', async () => {
        const document = await open('fixable.html');
        const [body] = await diagnosticsOf(document.uri, found => found.some(d => code(d) === 'aria-hidden-body'))
            .then(found => found.filter(d => code(d) === 'aria-hidden-body'));
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider', document.uri, body.range, vscode.CodeActionKind.QuickFix.value);
        const fix = actions.find(action => action.title === 'Fix this Finding (aria-hidden-body)');
        assert.ok(fix?.edit, actions.map(action => action.title).join('\n'));
        assert.ok(fix.isPreferred);
        assert.ok(await vscode.workspace.applyEdit(fix.edit));
        assert.match(document.getText(), /<body>/);
        await document.save();
        await diagnosticsOf(document.uri, found => found.length > 0 && !found.some(d => code(d) === 'aria-hidden-body'));
    });

    test('the lightbulb ignores a Finding with a comment, prepared only when picked', async () => {
        const document = await open('ignorable.html');
        const [alt] = await diagnosticsOf(document.uri, found => found.some(d => code(d) === 'image-alt'))
            .then(found => found.filter(d => code(d) === 'image-alt'));
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider', document.uri, alt.range, vscode.CodeActionKind.QuickFix.value);
        const ignore = actions.find(action => action.title === 'Ignore this Finding (image-alt)');
        assert.ok(ignore?.command && !ignore.edit, actions.map(action => action.title).join('\n'));
        assert.ok(actions.some(action => action.title === 'Disable rule image-alt'));
        await vscode.commands.executeCommand(ignore.command.command, ...(ignore.command.arguments ?? []) as unknown[]);
        assert.match(document.getText(), /<!-- allyproof-ignore image-alt -->\r?\n<img/);
        await document.save();
        await diagnosticsOf(document.uri, found => !found.some(d => code(d) === 'image-alt'));
    });

    test('a file reopened after its tab closed shows its Findings again', async () => {
        const document = await open('index.html');
        await diagnosticsOf(document.uri, found => found.length > 0);
        // Its Findings go with its tab, while VS Code keeps the document open for a while, as when a preview tab is replaced
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await until(() => vscode.languages.getDiagnostics(document.uri).length === 0, 'the closed tab kept its Findings');
        await open('index.html');
        await diagnosticsOf(document.uri, found => found.length > 0);
    });

    test('a read-only copy of a file, such as a diff side, gets no Findings', async () => {
        const copies = vscode.workspace.registerTextDocumentContentProvider('allyproof-copy', {
            provideTextDocumentContent: () => '<html><body><img src="logo.png"></body></html>'
        });
        try {
            const copy = await vscode.workspace.openTextDocument(vscode.Uri.parse('allyproof-copy:/index.html'));
            await vscode.languages.setTextDocumentLanguage(copy, 'html');
            // Pinned, so opening the file below does not replace the copy's tab and with it its Findings
            await vscode.window.showTextDocument(copy, { preview: false });
            // The worker checks one document at a time, so the copy would be checked before the file opened after it
            const document = await open('index.html');
            await diagnosticsOf(document.uri, found => found.length > 0);
            assert.deepStrictEqual(vscode.languages.getDiagnostics(copy.uri), []);
            assert.ok(!api.findings.getChildren().some(node => node.kind === 'file' && node.uri === copy.uri.toString()));
        } finally {
            copies.dispose();
        }
    });

    test('Check Workspace fills the Findings tree with files that are not open, without diagnostics', async () => {
        await vscode.commands.executeCommand('allyproof.checkWorkspace');
        const file = api.findings.getChildren().find(node => api.findings.getTreeItem(node).label === 'unopened.html');
        assert.ok(file?.kind === 'file', 'unopened.html is not in the Findings tree');
        assert.match(String(api.findings.getTreeItem(file).accessibilityInformation?.label), /^unopened\.html, [1-9]\d* Findings?/);
        assert.ok(!vscode.workspace.textDocuments.some(document => document.uri.path.endsWith('/unopened.html')), 'the Check opened the file');
        assert.deepStrictEqual(vscode.languages.getDiagnostics(vscode.Uri.parse(file.uri)), []);
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

    if (trusted) test('Cancel ends an AI Review whose model lookup is pending, and the next one starts', async () => {
        // A local server that holds every model lookup until the test ends
        const requests: string[] = [];
        const held: http.ServerResponse[] = [];
        const server = http.createServer((request, response) => {
            requests.push(`${request.method} ${request.url}`);
            held.push(response);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const settings = vscode.workspace.getConfiguration('allyproof');
        try {
            await settings.update('aiReview.localEndpoint', `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, vscode.ConfigurationTarget.Global);
            await settings.update('aiReview.provider', 'local', vscode.ConfigurationTarget.Global);
            await open('index.html');
            const first = vscode.commands.executeCommand('allyproof.startAIReview');
            await until(() => requests.length === 1, 'the model lookup never reached the server');

            await vscode.commands.executeCommand('allyproof.cancelAIReview');
            await first;
            assert.match(api.aiReviewStatus.text, /AI Review cancelled/);

            const second = vscode.commands.executeCommand('allyproof.startAIReview');
            await until(() => requests.length === 2, 'the next AI Review never started');
            await vscode.commands.executeCommand('allyproof.cancelAIReview');
            await second;
        } finally {
            held.forEach(response => response.destroy());
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
