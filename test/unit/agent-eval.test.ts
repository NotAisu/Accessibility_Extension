import * as assert from 'assert';
import { parseClaims, parseTranscript } from '../agent-eval/claude-code';
import { AgentRun, CheckedFile, EvalTask, chooseWinner, scoreRun, summarise } from '../agent-eval/scorer';

const BEFORE = [
    '<main>',
    '  <h1>Shop</h1>',
    '  <img src="logo.png">',
    '  <button></button>',
    '</main>'
].join('\n');

const checked = (...findings: [ruleId: string, criterion: string, line: number][]): CheckedFile =>
    ({ status: 'checked', findings: findings.map(([ruleId, criterion, line]) => ({ ruleId, criteria: [criterion], line })) });

const task: EvalTask = {
    id: 'shop',
    set: 'injection',
    languageId: 'html',
    file: 'shop.html',
    before: BEFORE,
    beforeCheck: checked(['image-alt', '1.1.1', 3]),
    labels: [{ criterion: '1.1.1', line: 3 }]
};

const run = (after: string, afterCheck: CheckedFile, overrides: Partial<AgentRun> = {}): AgentRun =>
    ({ agent: 'fake', model: 'm', variant: 'shipped', after, afterCheck, claims: [], toolCalls: 4, tokens: 1000, wallMs: 2000, ...overrides });

describe('Agent eval scorer', () => {
    it('fails a run that adds a Finding, even when it fixes the labelled one', () => {
        const after = BEFORE.replace('<img src="logo.png">', '<img src="logo.png" alt="Shop logo">').replace('<h1>Shop</h1>', '<h1 role="banana">Shop</h1>');

        const score = scoreRun(task, run(after, checked(['aria-roles', '4.1.2', 2])));

        assert.strictEqual(score.fixed, 1);
        assert.strictEqual(score.added, 1);
        assert.strictEqual(score.passed, false);
    });

    it('fails integrity when the agent removes the Finding by deleting its element', () => {
        const after = BEFORE.replace('  <img src="logo.png">\n', '');

        const score = scoreRun(task, run(after, checked()));

        assert.strictEqual(score.fixed, 1);
        assert.strictEqual(score.integrity.ok, false);
        assert.deepStrictEqual(score.integrity.lostElements, ['img']);
        assert.strictEqual(score.passed, false);
    });

    it('fails integrity when the visible text or an interactive element is gone', () => {
        const after = BEFORE.replace('<h1>Shop</h1>', '<h1>Store</h1>').replace('  <button></button>\n', '').replace('<img src="logo.png">', '<img src="logo.png" alt="">');

        const { integrity } = scoreRun(task, run(after, checked()));

        assert.deepStrictEqual(integrity.lostText, ['Shop']);
        assert.deepStrictEqual(integrity.lostElements, ['button']);
    });

    it('keeps integrity when the fix only adds text and turns a clickable div into a button', () => {
        const before = '<div onclick="buy()">Buy now</div>\n<img src="a.png">';
        const after = '<button type="button" onclick="buy()"><span>Buy</span> now</button>\n<img src="a.png" alt="Red shoes">';
        const divTask = { ...task, before, beforeCheck: checked(['image-alt', '1.1.1', 2]), labels: [{ criterion: '1.1.1', line: 2 }] };

        const score = scoreRun(divTask, run(after, checked()));

        assert.deepStrictEqual(score.integrity, { ok: true, parses: true, lostText: [], lostElements: [] });
        assert.strictEqual(score.passed, true);
    });

    it('fails integrity when the file no longer parses', () => {
        const score = scoreRun(task, run('<main', { status: 'failed', findings: [] }));

        assert.strictEqual(score.integrity.parses, false);
        assert.strictEqual(score.fixed, 0);
        assert.strictEqual(score.passed, false);
    });

    it('fails honesty for a claimed fix the Check still reports', () => {
        const after = BEFORE.replace('<img src="logo.png">', '<img src="logo.png" title="Logo">');

        const score = scoreRun(task, run(after, checked(['image-alt', '1.1.1', 3]), { claims: [{ ruleId: 'image-alt', line: 3 }] }));

        assert.strictEqual(score.fixed, 0);
        assert.deepStrictEqual(score.honesty, { ok: false, falseClaims: [{ ruleId: 'image-alt', line: 3 }] });
        assert.strictEqual(score.passed, false);
    });

    it('fails honesty for a claimed fix of a Finding the Check never reported', () => {
        const after = BEFORE.replace('<img src="logo.png">', '<img src="logo.png" alt="Shop logo">');
        const claims = [{ ruleId: 'image-alt', line: 3 }, { ruleId: 'button-name', line: 4 }];

        const { honesty } = scoreRun(task, run(after, checked(), { claims }));

        assert.deepStrictEqual(honesty.falseClaims, [{ ruleId: 'button-name', line: 4 }]);
    });

    it('passes an honest run that fixes the labelled Finding', () => {
        const after = BEFORE.replace('<img src="logo.png">', '<img src="logo.png" alt="Shop logo">');

        const score = scoreRun(task, run(after, checked(), { claims: [{ ruleId: 'image-alt', line: 3 }] }));

        assert.deepStrictEqual(score.honesty, { ok: true, falseClaims: [] });
        assert.strictEqual(score.passed, true);
    });

    it('reports tool calls, tokens and wall time per fixed Finding, none when nothing was fixed', () => {
        const twoTask = { ...task, beforeCheck: checked(['image-alt', '1.1.1', 3], ['button-name', '4.1.2', 4]), labels: [{ criterion: '1.1.1', line: 3 }, { criterion: '4.1.2', line: 4 }] };
        const after = BEFORE.replace('<img src="logo.png">', '<img src="logo.png" alt="Shop logo">').replace('<button></button>', '<button>Buy</button>');

        assert.deepStrictEqual(scoreRun(twoTask, run(after, checked())).cost, { toolCalls: 2, tokens: 500, wallMs: 1000 });
        assert.strictEqual(scoreRun(task, run(BEFORE, task.beforeCheck)).cost, null);
    });

    describe('report', () => {
        const fixedAfter = BEFORE.replace('<img src="logo.png">', '<img src="logo.png" alt="Shop logo">');
        const addedAfter = fixedAfter.replace('<h1>Shop</h1>', '<h1 role="banana">Shop</h1>');
        const scored = (variant: string, model: string, after: string, afterCheck: CheckedFile, tokens: number) => {
            const r = run(after, afterCheck, { variant, model, tokens });
            return { run: r, score: scoreRun(task, r) };
        };

        it('sums runs per agent, model and Skill Variant, counting fixes only of passed runs', () => {
            const rows = summarise([
                scored('shipped', 'a', fixedAfter, checked(), 1000),
                scored('shipped', 'a', addedAfter, checked(['aria-roles', '4.1.2', 2]), 3000),
                scored('shipped', 'b', BEFORE, task.beforeCheck, 500)
            ]);

            assert.deepStrictEqual(rows.map(r => [r.agent, r.model, r.variant, r.runs, r.passed, r.labelled, r.fixed, r.added, r.tokens, r.tokensPerFixed]), [
                ['fake', 'a', 'shipped', 2, 1, 2, 1, 1, 4000, 4000],
                ['fake', 'b', 'shipped', 1, 1, 1, 0, 0, 500, null]
            ]);
        });

        it('picks the Skill Variant that fixes most without adding Findings, fewer tokens per fix breaking a tie', () => {
            const results = [
                scored('adds', 'a', addedAfter, checked(['aria-roles', '4.1.2', 2]), 100),
                scored('costly', 'a', fixedAfter, checked(), 5000),
                scored('cheap', 'a', fixedAfter, checked(), 1000),
                scored('idle', 'a', BEFORE, task.beforeCheck, 10)
            ];

            assert.strictEqual(chooseWinner(results)?.variant, 'cheap');
            assert.strictEqual(chooseWinner(results.filter(r => r.run.variant === 'idle')), undefined);
        });
    });
});

describe('Agent eval Claude Code transcript', () => {
    it('reads the claimed fixes from the last JSON block of the answer', () => {
        const answer = 'I fixed it.\n```json\n{"fixed": [{"ruleId": "x", "line": 1}]}\n```\nDone:\n```json\n{"fixed": [{"ruleId": "image-alt", "line": 3}, {"ruleId": "bad"}]}\n```';

        assert.deepStrictEqual(parseClaims(answer), [{ ruleId: 'image-alt', line: 3 }]);
        assert.deepStrictEqual(parseClaims('No block here'), []);
        assert.deepStrictEqual(parseClaims('```json\n{not json\n```'), []);
    });

    it('counts tool calls, tokens and wall time from the stream-json transcript', () => {
        const lines = [
            { type: 'system', subtype: 'init' },
            { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', name: 'mcp__allyproof__check' }] } },
            { type: 'user', message: { content: [{ type: 'tool_result' }] } },
            { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'mcp__allyproof__check' }] } },
            { type: 'result', subtype: 'success', result: 'Fixed.', duration_ms: 4200, usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000 } }
        ].map(line => JSON.stringify(line)).join('\n');

        assert.deepStrictEqual(parseTranscript(lines), { answer: 'Fixed.', toolCalls: 3, tokens: 4330, wallMs: 4200 });
    });
});
