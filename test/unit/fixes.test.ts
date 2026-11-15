import * as assert from 'assert';
import { analyse, Finding } from '../../src/core/analysis';

// The text after applying a Finding's fix, edits applied back to front so earlier offsets stay valid
function applyFix(text: string, finding: Finding): string {
    assert.ok(finding.fix, `${finding.ruleId} has no fix`);
    return [...finding.fix].sort((a, b) => b.range.start - a.range.start)
        .reduce((result, edit) => result.slice(0, edit.range.start) + edit.newText + result.slice(edit.range.end), text);
}

async function fixed(languageId: string, text: string, criterion: string): Promise<string> {
    const { findings } = await analyse({ languageId, text });
    const finding = findings.find(f => f.criteria[0] === criterion);
    assert.ok(finding, `no Finding for ${criterion}`);
    return applyFix(text, finding);
}

describe('deterministic fixes', () => {
    it('adds a missing lang to the html element in HTML', async () => {
        const text = '<!DOCTYPE html>\n<html><head><title>t</title></head><body><main><p>Hi</p></main></body></html>';

        assert.strictEqual(
            await fixed('html', text, '3.1.1'),
            '<!DOCTYPE html>\n<html lang="en"><head><title>t</title></head><body><main><p>Hi</p></main></body></html>'
        );
    });

    it('adds a missing lang to the html element in JSX and Svelte', async () => {
        assert.strictEqual(
            await fixed('javascriptreact', 'const Page = () => <html><body><p>Hi</p></body></html>;', '3.1.1'),
            'const Page = () => <html lang="en"><body><p>Hi</p></body></html>;'
        );
        assert.strictEqual(
            await fixed('svelte', '<html><body><p>Hi</p></body></html>', '3.1.1'),
            '<html lang="en"><body><p>Hi</p></body></html>'
        );
    });

    it('offers no fix for an empty lang, which needs the author\'s language', async () => {
        const { findings } = await analyse({ languageId: 'html', text: '<html lang=""><head><title>t</title></head><body><p>Hi</p></body></html>' });

        assert.ok(findings.some(f => f.criteria[0] === '3.1.1'));
        assert.ok(findings.every(f => !f.fix));
    });

    it('removes aria-hidden from the body element', async () => {
        const text = '<html lang="en"><head><title>t</title></head><body class="app" aria-hidden="true"><p>Hi</p></body></html>';

        assert.strictEqual(
            await fixed('html', text, '1.3.1'),
            '<html lang="en"><head><title>t</title></head><body class="app"><p>Hi</p></body></html>'
        );
    });
});
