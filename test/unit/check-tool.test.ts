import * as assert from 'assert';
import { analyse } from '../../src/core/analysis';
import { CheckToolInput, CheckToolOutput, CheckToolPorts, runCheckTool } from '../../src/review/check-tool';

const ports: CheckToolPorts = {
    languages: ['html', 'javascriptreact', 'typescriptreact'],
    read: filePath => Promise.reject(new Error(`File not found: ${filePath}`)),
    check: async document => ({ status: 'done', result: await analyse(document), durationMs: 0, firstLoad: false })
};

async function run(input: CheckToolInput, withPorts = ports): Promise<CheckToolOutput> {
    return JSON.parse(await runCheckTool(input, withPorts)) as CheckToolOutput;
}

const proposed = '<main>\n  <img src="chart.png">\n</main>';

describe('a11y_check tool', () => {
    it('checks proposed code and reports each Finding on its 1-based line', async () => {
        const output = await run({ code: proposed, languageId: 'html' });

        const image = output.findings.find(f => f.criteria.includes('1.1.1'));
        assert.ok(image, JSON.stringify(output.findings));
        assert.strictEqual(image.line, 2);
        assert.ok(['error', 'warning', 'information'].includes(image.severity));
        assert.ok(image.message);
        assert.ok(image.helpUrl);
        assert.ok(Array.isArray(output.needsReview));
    });

    it('counts lines as the editor does, across every line break', async () => {
        for (const lineBreak of ['\r\n', '\r', '\u2028']) {
            const code = ['<main>', '  <p>Sales</p>', '  <img src="chart.png">', '</main>'].join(lineBreak);

            const output = await run({ code, languageId: 'html' });

            assert.deepStrictEqual(output.findings.filter(f => f.criteria.includes('1.1.1')).map(f => f.line), [3], JSON.stringify(lineBreak));
        }
    });
});

describe('a11y_check tool on files', () => {
    const files: Record<string, string> = { 'src/App.tsx': 'export const App = () => (\n  <span tabIndex={2}>x</span>\n);' };
    const withFiles: CheckToolPorts = {
        ...ports,
        read: filePath => filePath in files
            ? Promise.resolve({ languageId: 'typescriptreact', text: files[filePath] })
            : Promise.reject(new Error(`File not found: ${filePath}`))
    };

    it('checks the file when only filePath is given, an Unproven rule\'s match as Needs Review on its line', async () => {
        const output = await run({ filePath: 'src/App.tsx' }, withFiles);

        assert.strictEqual(output.languageId, 'typescriptreact');
        assert.deepStrictEqual(output.findings, []);
        assert.deepStrictEqual(output.needsReview.filter(e => e.ruleId).map(e => [e.ruleId, e.criterion, e.line]), [['jsx-a11y-x/tabindex-no-positive', '2.4.3', 2]]);
    });

    it('checks proposed code in the language of the file it is meant for', async () => {
        const fixed = 'export const App = () => (\n  <img src="a.png" alt="Sales by month" />\n);';

        const output = await run({ filePath: 'src/App.tsx', code: fixed }, withFiles);

        assert.strictEqual(output.languageId, 'typescriptreact');
        assert.deepStrictEqual(output.findings, []);
    });
});

describe('a11y_check tool errors', () => {
    it('asks for a file or code when given neither', async () => {
        await assert.rejects(runCheckTool({}, ports), /Pass filePath .* code/);
    });

    it('names the supported languages for code in another language', async () => {
        await assert.rejects(runCheckTool({ code: 'x', languageId: 'python' }, ports), /python.*html, javascriptreact, typescriptreact/);
    });

    it('says why when the Check is paused, so the agent does not read it as no Findings', async () => {
        const paused: CheckToolPorts = {
            ...ports,
            check: () => Promise.resolve({ status: 'paused', reason: 'The Check took longer than 1000 ms', deadlineExceeded: true })
        };

        await assert.rejects(runCheckTool({ code: proposed, languageId: 'html' }, paused), /paused: The Check took longer than 1000 ms/);
    });
});
