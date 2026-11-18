import * as assert from 'assert';
import { Finding } from '../../src/core/analysis';
import { analyse } from './every-rule';

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

    it('keeps the guessed lang a quick fix only, never applied by fix all or on save', async () => {
        const { findings } = await analyse({ languageId: 'html', text: '<html><head><title>t</title></head><body><p>Hi</p></body></html>' });
        const lang = findings.find(f => f.criteria[0] === '3.1.1');

        assert.ok(lang?.fix);
        assert.strictEqual(lang.quickFixOnly, true);
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
        const { findings } = await analyse({ languageId: 'html', text });
        assert.strictEqual(findings.find(f => f.criteria[0] === '1.3.1')?.quickFixOnly, undefined, 'safe to apply on save');
    });

    it('removes the aria-hidden attribute itself, never the words in another attribute\'s value', async () => {
        const page = (body: string) => `<html lang="en"><head><title>t</title></head>${body}<p>Hi</p></body></html>`;

        assert.strictEqual(
            await fixed('html', page('<body data-note="not aria-hidden" aria-hidden="true">'), '1.3.1'),
            page('<body data-note="not aria-hidden">')
        );
        assert.strictEqual(await fixed('html', page('<body title="a > b" aria-hidden="true">'), '1.3.1'), page('<body title="a > b">'));
        assert.strictEqual(await fixed('html', page('<BODY ARIA-HIDDEN=true>'), '1.3.1'), page('<BODY>'));
    });

    it('adds lang when only another attribute\'s value mentions lang', async () => {
        const text = '<html class="no lang"><head><title>t</title></head><body><p>Hi</p></body></html>';

        assert.strictEqual(await fixed('html', text, '3.1.1'), text.replace('<html', '<html lang="en"'));
    });

    it('fixes the Finding and changes nothing else, whatever the start tag holds', async () => {
        // Seeded attribute soup: values that mention the fixed attribute, hold > or quotes, unquoted and bare attributes
        let seed = 7;
        const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
        const attribute = () => pick([
            'class="app"', 'data-note="not aria-hidden"', 'title="a > b"', "data-x='lang \"q\"'", 'data-y=plain', 'hidden',
            'data-lang="de"', 'id=main', 'title="aria-hidden=true lang=en"'
        ]);
        for (let i = 0; i < 40; i++) {
            const extra = Array.from({ length: 1 + Math.floor(next() * 3) }, attribute);
            const body = `<body ${[...extra.slice(1), 'aria-hidden="true"', extra[0]].join(' ')}>`;
            const html = `<html ${extra.join(' ')}>`;
            const text = `${html}<head><title>t</title></head>${body}<p>Hi</p></body></html>`;
            const { findings } = await analyse({ languageId: 'html', text });
            // No soup value holds ` aria-hidden="true"` and no soup attribute is named lang, so each fix has one right result
            const expected: Record<string, string> = {
                '3.1.1': text.replace('<html', '<html lang="en"'),
                '1.3.1': text.replace(body, body.replace(' aria-hidden="true"', ''))
            };
            const fixable = findings.filter(f => f.fix);
            assert.deepStrictEqual(fixable.map(f => f.criteria[0]).sort(), ['1.3.1', '3.1.1'], `both fixes offered for ${text}`);
            for (const finding of fixable) {
                const result = applyFix(text, finding);
                assert.strictEqual(result, expected[finding.criteria[0]], `${finding.ruleId} on ${text}`);
                const after = await analyse({ languageId: 'html', text: result });
                assert.ok(!after.findings.some(f => f.ruleId === finding.ruleId), `${finding.ruleId} still reported after its fix: ${result}`);
            }
        }
    });
});
