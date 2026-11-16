import * as assert from 'assert';
import type { CheckOutcome } from '../../src/analysis-worker';
import type { AnalysisDocument, AnalysisOptions } from '../../src/core/analysis';
import { ignoredFiles, positionsOf, WorkspaceCheck, WorkspaceCheckRun, WorkspaceFile, workspaceLanguageId } from '../../src/workspace-check';

const done = (text: string): CheckOutcome => ({ status: 'done', result: { findings: [], needsReview: [{ criterion: text, reason: '' }] }, durationMs: 1, firstLoad: false });

// A workspace on disk and a Check that records what it ran; a file's text says how its Check ends
function fakeHost(disk: Record<string, string>) {
    const checked: AnalysisDocument[] = [];
    const reported: { uri: string; status: string }[] = [];
    const removed: string[] = [];
    let options: AnalysisOptions = {};
    let running = 0;
    let mostAtOnce = 0;
    const check = new WorkspaceCheck({
        read: ({ uri }) => uri in disk ? Promise.resolve(disk[uri]) : Promise.reject(new Error('ENOENT')),
        options: () => options,
        check: async (_file, document) => {
            checked.push(document);
            mostAtOnce = Math.max(mostAtOnce, ++running);
            await new Promise(resolve => setTimeout(resolve, 1));
            running--;
            if (document.text === 'fail') return { status: 'paused', reason: 'engine failed', deadlineExceeded: false };
            if (document.text === 'huge') return { status: 'paused', reason: 'The Check took longer than 1000 ms', deadlineExceeded: true };
            return done(document.text);
        },
        report: ({ uri }, _text, outcome) => reported.push({ uri, status: outcome.status }),
        remove: uri => removed.push(uri)
    });
    return {
        check,
        checked,
        reported,
        removed,
        setOptions: (next: AnalysisOptions) => options = next,
        mostAtOnce: () => mostAtOnce
    };
}

const files = (disk: Record<string, string>): WorkspaceFile[] => Object.keys(disk).map(uri => ({ uri, path: uri.replace('file://', '') }));
const quiet: WorkspaceCheckRun = { isOpen: () => false, progress: () => {}, cancelled: () => false };

describe('workspace Check', () => {
    it('knows the language of every file the Check analyses by its extension', () => {
        assert.strictEqual(workspaceLanguageId('/p/index.HTML'), 'html');
        assert.strictEqual(workspaceLanguageId('/p/App.tsx'), 'typescriptreact');
        assert.strictEqual(workspaceLanguageId('/p/Card.jsx'), 'javascriptreact');
        assert.strictEqual(workspaceLanguageId('/p/app.component.ts'), 'typescript');
        assert.strictEqual(workspaceLanguageId('/p/main.js'), undefined);
        assert.strictEqual(workspaceLanguageId('/p/.html/README'), undefined);
    });

    it('checks each file one at a time, as the language the Check analyses it as', async () => {
        const disk = { 'file:///p/a.html': 'a', 'file:///p/b.component.html': 'b', 'file:///p/c.vue': 'c', 'file:///p/d.svelte': 'd' };
        const host = fakeHost(disk);

        const summary = await host.check.run(files(disk), quiet);

        assert.deepStrictEqual(host.checked.map(d => d.languageId), ['html', 'angular', 'vue', 'svelte']);
        assert.deepStrictEqual(host.reported.map(r => r.uri), Object.keys(disk));
        assert.strictEqual(host.mostAtOnce(), 1);
        assert.deepStrictEqual(summary, { files: 4, checked: 4, unchanged: 0, paused: 0, cancelled: false });
    });

    it('skips TypeScript files without an Angular component', async () => {
        const disk = { 'file:///p/util.ts': 'export const x = 1;', 'file:///p/app.component.ts': '@Component({ template: "" })' };
        const host = fakeHost(disk);

        await host.check.run(files(disk), quiet);

        assert.deepStrictEqual(host.reported.map(r => r.uri), ['file:///p/app.component.ts']);
    });

    it('leaves open files to their editor\'s Check', async () => {
        const disk = { 'file:///p/a.html': 'a', 'file:///p/b.html': 'b' };
        const host = fakeHost(disk);

        await host.check.run(files(disk), { ...quiet, isOpen: uri => uri === 'file:///p/a.html' });

        assert.deepStrictEqual(host.reported.map(r => r.uri), ['file:///p/b.html']);
        // Once its editor closes, the open file is checked as its text on disk
        assert.ok(host.check.covers('file:///p/a.html'));
        await host.check.recheck({ uri: 'file:///p/a.html', path: '/p/a.html' });
        assert.deepStrictEqual(host.reported.map(r => r.uri), ['file:///p/b.html', 'file:///p/a.html']);
    });

    it('re-checks only the files that changed since the last run', async () => {
        const disk: Record<string, string> = { 'file:///p/a.html': 'a', 'file:///p/b.html': 'b' };
        const host = fakeHost(disk);
        await host.check.run(files(disk), quiet);
        disk['file:///p/b.html'] = 'b2';

        const summary = await host.check.run(files(disk), quiet);

        assert.deepStrictEqual(host.checked.map(d => d.text), ['a', 'b', 'b2']);
        assert.deepStrictEqual(summary, { files: 2, checked: 1, unchanged: 1, paused: 0, cancelled: false });
    });

    it('re-checks every file once its rule settings changed', async () => {
        const disk = { 'file:///p/a.html': 'a' };
        const host = fakeHost(disk);
        await host.check.run(files(disk), quiet);
        host.setOptions({ rules: { 'image-alt': 'off' } });

        await host.check.run(files(disk), quiet);

        assert.deepStrictEqual(host.checked.map(d => d.text), ['a', 'a']);
    });

    it('re-checks every file once its Component Mapping changed', async () => {
        const disk = { 'file:///p/a.html': 'a' };
        const host = fakeHost(disk);
        host.setOptions({ components: { components: { Button: 'button' } } });
        await host.check.run(files(disk), quiet);
        host.setOptions({ components: { components: { Button: 'button' }, polymorphicPropName: 'as' } });
        await host.check.run(files(disk), quiet);
        host.setOptions({ components: { components: { Button: 'a' }, polymorphicPropName: 'as' } });

        await host.check.run(files(disk), quiet);

        assert.deepStrictEqual(host.checked.map(d => d.text), ['a', 'a', 'a']);
    });

    it('re-checks a file whose engine failed, but not one too large for the deadline that did not change', async () => {
        const disk = { 'file:///p/a.html': 'fail', 'file:///p/b.html': 'huge' };
        const host = fakeHost(disk);
        const first = await host.check.run(files(disk), quiet);

        await host.check.run(files(disk), quiet);

        assert.strictEqual(first.paused, 2);
        assert.deepStrictEqual(host.checked.map(d => d.text), ['fail', 'huge', 'fail']);
        assert.deepStrictEqual(host.reported.map(r => r.status), ['paused', 'paused', 'paused']);
    });

    it('removes the results of files deleted or excluded since the last run, unless they are open', async () => {
        const disk: Record<string, string> = { 'file:///p/a.html': 'a', 'file:///p/b.html': 'b', 'file:///p/c.html': 'c' };
        const host = fakeHost(disk);
        await host.check.run(files(disk), quiet);
        delete disk['file:///p/a.html'];

        // a.html is gone from disk but still listed, b.html no longer listed, c.html no longer listed but open
        await host.check.run([{ uri: 'file:///p/a.html', path: '/p/a.html' }], { ...quiet, isOpen: uri => uri === 'file:///p/c.html' });

        assert.deepStrictEqual(host.removed.sort(), ['file:///p/a.html', 'file:///p/b.html']);
        assert.ok(!host.check.covers('file:///p/c.html'));
    });

    it('stops at the next file once cancelled, and reports progress per file', async () => {
        const disk = { 'file:///p/a.html': 'a', 'file:///p/b.html': 'b', 'file:///p/c.html': 'c' };
        const host = fakeHost(disk);
        const progress: string[] = [];

        const summary = await host.check.run(files(disk), {
            isOpen: () => false,
            progress: (n, total) => progress.push(`${n}/${total}`),
            cancelled: () => host.checked.length === 2
        });

        assert.deepStrictEqual(host.checked.map(d => d.text), ['a', 'b']);
        assert.deepStrictEqual(progress, ['0/3', '1/3']);
        assert.ok(summary.cancelled);
    });

    it('re-checks one file from disk without touching the others', async () => {
        const disk: Record<string, string> = { 'file:///p/a.html': 'a', 'file:///p/b.html': 'b' };
        const host = fakeHost(disk);
        await host.check.run(files(disk), quiet);

        await host.check.recheck({ uri: 'file:///p/a.html', path: '/p/a.html' });

        assert.deepStrictEqual(host.checked.map(d => d.text), ['a', 'b', 'a']);
        assert.deepStrictEqual(host.removed, []);
        assert.ok(host.check.covers('file:///p/b.html'));
    });

    it('maps offsets to the lines VS Code counts', () => {
        const at = positionsOf('a\r\nbc\nd\re f');

        assert.deepStrictEqual([0, 3, 4, 6, 8, 10].map(at), [
            { line: 0, character: 0 },
            { line: 1, character: 0 },
            { line: 1, character: 1 },
            { line: 2, character: 0 },
            { line: 3, character: 0 },
            { line: 3, character: 2 }
        ]);
    });
});

describe('ignoredFiles', () => {
    it('ignores what the .gitignore files of a file\'s folders ignore', () => {
        const ignored = ignoredFiles([
            { dir: '/p', content: 'dist/\n*.generated.html\n# comment\n' },
            { dir: '/p/web', content: '/legacy\n' }
        ]);

        assert.ok(ignored('/p/dist/index.html'));
        assert.ok(ignored('/p/web/page.generated.html'));
        assert.ok(ignored('/p/web/legacy/old.html'));
        assert.ok(!ignored('/p/legacy/old.html'), 'an anchored pattern applies to its own folder only');
        assert.ok(!ignored('/p/web/index.html'));
    });

    it('lets a deeper .gitignore re-include a file, but nothing inside an ignored folder', () => {
        const ignored = ignoredFiles([
            { dir: '/p', content: '*.html\nbuild/\n' },
            { dir: '/p/site', content: '!keep.html\n' },
            { dir: '/p/build', content: '!keep.html\n' }
        ]);

        assert.ok(!ignored('/p/site/keep.html'));
        assert.ok(ignored('/p/site/other.html'));
        assert.ok(ignored('/p/build/keep.html'));
    });

    it('always ignores installed dependencies', () => {
        assert.ok(ignoredFiles([])('/p/node_modules/pkg/index.html'));
        assert.ok(!ignoredFiles([])('/p/src/index.html'));
    });
});
