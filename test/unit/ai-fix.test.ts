import * as assert from 'assert';
import { addedFindings, fixTarget, FixOptions, locate, plain, proposeFix } from '../../src/review/ai-fix';
import { ModelError, ModelPort, ModelRequest } from '../../src/review/ai-review';
import type { AnalysisDocument, Finding } from '../../src/core/analysis';

const text = [
    '<main>',
    '  <img src="logo.png">',
    '  <p>Welcome</p>',
    '</main>'
].join('\n');
const document = { languageId: 'html', text };
const imgStart = text.indexOf('<img');
const imageFinding: Finding = {
    range: { start: imgStart, end: imgStart + '<img src="logo.png">'.length },
    criteria: ['1.1.1'],
    ruleId: 'image-alt',
    layer: 'check',
    severity: 'warning',
    message: 'Images must have alternative text.',
    explanation: 'Add an alt attribute.',
    helpUrl: 'https://example.com'
};
const target = fixTarget(text, imageFinding.range);
const fixed = '  <img src="logo.png" alt="Company logo">';

/** Answers each request with the next reply; a function reply may throw. */
function fakeModel(...replies: unknown[]): ModelPort & { requests: ModelRequest[] } {
    const requests: ModelRequest[] = [];
    return {
        id: 'fake/model-1',
        name: 'Fake Model',
        maxInputTokens: 100_000,
        countTokens: value => Promise.resolve(Math.ceil(value.length / 4)),
        requests,
        request(request) {
            requests.push(request);
            const reply = replies.shift();
            return typeof reply === 'function' ? (reply as () => Promise<unknown>)() : Promise.resolve(reply);
        }
    };
}

/** A Check that reports the image Finding wherever an <img> has no alt, and a button Finding for every <div onclick>. */
function fakeCheck(checked: AnalysisDocument[] = []): FixOptions['check'] {
    return document => {
        checked.push(document);
        const findings: Finding[] = [];
        for (const match of document.text.matchAll(/<img(?![^>]*\balt=)[^>]*>/g)) {
            findings.push({ ...imageFinding, range: { start: match.index, end: match.index + match[0].length } });
        }
        for (const match of document.text.matchAll(/<div onclick/g)) {
            findings.push({ ...imageFinding, ruleId: 'click-events', criteria: ['2.1.1'], range: { start: match.index, end: match.index + 4 } });
        }
        return Promise.resolve(findings);
    };
}

const options = (model: ModelPort, check = fakeCheck()): FixOptions => ({ model, skill: { text: 'The Skill.' }, check });

describe('AI fixes', () => {
    it('proposes a verified edit of exactly the Finding\'s lines', async () => {
        const model = fakeModel({ replacement: fixed, explanation: 'Adds alt text.' });

        const outcome = await proposeFix({ document, finding: imageFinding, target }, options(model));

        assert.ok(outcome.status === 'proposed', outcome.status);
        assert.strictEqual(text.slice(outcome.edit.range.start, outcome.edit.range.end), '  <img src="logo.png">');
        assert.strictEqual(outcome.edit.newText, fixed);
        assert.strictEqual(outcome.text, text.replace('  <img src="logo.png">', fixed));
        assert.strictEqual(outcome.explanation, 'Adds alt text.');
    });

    it('marks the code and the Finding as data between a random boundary and offers only its own tool', async () => {
        const model = fakeModel({ replacement: fixed, explanation: 'Adds alt text.' });

        await proposeFix({ document, finding: imageFinding, target }, options(model));

        const [request] = model.requests;
        assert.strictEqual(request.tool.name, 'propose_fix');
        assert.ok(request.messages[0].startsWith('The Skill.'));
        assert.match(request.messages[0], /Replace line 2 /);
        const boundary = /<<<data ([0-9a-f-]{36})>>>/.exec(request.messages[1])?.[1];
        assert.ok(boundary);
        assert.ok(request.messages[1].endsWith(`<<<end ${boundary}>>>`));
        assert.ok(request.messages[1].includes('2|   <img src="logo.png">'));
        assert.ok(request.messages[1].includes('Images must have alternative text.'));
    });

    it('refuses the fix when the target code changed since the Finding was reported, without asking the model', async () => {
        const model = fakeModel({ replacement: fixed, explanation: 'Adds alt text.' });
        const changed = { languageId: 'html', text: text.replace('logo.png', 'banner.png') };

        const outcome = await proposeFix({ document: changed, finding: imageFinding, target }, options(model));

        assert.ok(outcome.status === 'refused', outcome.status);
        assert.strictEqual(model.requests.length, 0);
    });

    it('fixes the target where it moved when only code elsewhere changed', async () => {
        const model = fakeModel({ replacement: fixed, explanation: 'Adds alt text.' });
        const moved = { languageId: 'html', text: `<!-- header -->\n${text}` };

        const outcome = await proposeFix({ document: moved, finding: imageFinding, target }, options(model));

        assert.ok(outcome.status === 'proposed', outcome.status);
        assert.strictEqual(outcome.text, moved.text.replace('  <img src="logo.png">', fixed));
    });

    it('refuses when the target moved and its lines occur more than once', () => {
        const twice = `${text}\n${text}`;
        assert.strictEqual(locate(target, `<p>Hi</p>\n${twice}`), undefined);
        assert.deepStrictEqual(locate(target, twice), target.range);
    });

    it('re-runs the Check on the proposed edit and discards a fix that adds Findings', async () => {
        const checked: AnalysisDocument[] = [];
        const model = fakeModel({ replacement: '  <div onclick="go()"><img src="logo.png" alt="Logo"></div>', explanation: 'Wraps it.' });

        const outcome = await proposeFix({ document, finding: imageFinding, target }, options(model, fakeCheck(checked)));

        assert.ok(outcome.status === 'discarded', outcome.status);
        assert.deepStrictEqual(outcome.added.map(f => f.ruleId), ['click-events']);
        assert.match(outcome.reason, /1 new Finding \(click-events\)/);
        assert.deepStrictEqual(checked.map(d => d.text.includes('onclick')), [false, true]);
    });

    it('discards a fix the Check could not verify', async () => {
        const model = fakeModel({ replacement: fixed, explanation: 'Adds alt text.' });
        const paused: FixOptions['check'] = () => Promise.resolve(undefined);

        const outcome = await proposeFix({ document, finding: imageFinding, target }, options(model, paused));

        assert.ok(outcome.status === 'discarded', outcome.status);
    });

    it('keeps a fix that leaves other Findings as they were', () => {
        const other = { ...imageFinding, range: { start: 50, end: 60 } };
        assert.deepStrictEqual(addedFindings([imageFinding, other], [other]), []);
        assert.deepStrictEqual(addedFindings([imageFinding], [imageFinding, other]), [other]);
    });

    it('asks once for a repair and fails when the model still gives no usable fix', async () => {
        const model = fakeModel(
            { replacement: '  <img src="logo.png">', explanation: 'Nothing.' },
            { replacement: '2|   <img src="logo.png" alt="Logo">', explanation: 'Numbered.' },
            { replacement: fixed, explanation: 'Unused.' }
        );

        const outcome = await proposeFix({ document, finding: imageFinding, target }, options(model));

        assert.ok(outcome.status === 'failed', outcome.status);
        assert.strictEqual(model.requests.length, 2);
        assert.match(model.requests[1].messages[2], /must change the target lines/);
    });

    it('uses the repaired fix', async () => {
        const model = fakeModel(undefined, { replacement: fixed, explanation: 'Adds alt text.' });

        const outcome = await proposeFix({ document, finding: imageFinding, target }, options(model));

        assert.ok(outcome.status === 'proposed', outcome.status);
    });

    it('passes on model errors such as a rate limit', async () => {
        const model = fakeModel(() => Promise.reject(new ModelError('Blocked', 'Rate limited.')));

        await assert.rejects(proposeFix({ document, finding: imageFinding, target }, options(model)), { code: 'Blocked' });
    });

    it('keeps the Windows line breaks of the file', async () => {
        const crlf = { languageId: 'html', text: text.replace(/\n/g, '\r\n') };
        const crlfTarget = fixTarget(crlf.text, { start: crlf.text.indexOf('<img'), end: crlf.text.indexOf('<img') + 5 });
        const model = fakeModel({ replacement: '  <img src="logo.png"\n       alt="Logo">', explanation: 'Adds alt text.' });

        const outcome = await proposeFix({ document: crlf, finding: imageFinding, target: crlfTarget }, options(model));

        assert.strictEqual(crlfTarget.text, '  <img src="logo.png">');
        assert.ok(outcome.status === 'proposed', outcome.status);
        assert.strictEqual(outcome.edit.newText, '  <img src="logo.png"\r\n       alt="Logo">');
    });

    it('hands the explanation over as one line of plain text, Markdown and HTML kept as literal characters', async () => {
        const explanation = 'Adds **alt**\n[text](command:workbench.action.terminal.new) <img src=x onerror="alert(1)">\u0007';
        const model = fakeModel({ replacement: fixed, explanation });

        const outcome = await proposeFix({ document, finding: imageFinding, target }, options(model));

        assert.ok(outcome.status === 'proposed', outcome.status);
        assert.strictEqual(outcome.explanation, 'Adds **alt** [text](command:workbench.action.terminal.new) <img src=x onerror="alert(1)">');
        assert.ok(plain('x'.repeat(2000)).length <= 500);
    });
});
