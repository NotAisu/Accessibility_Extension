/**
 * The local agent eval (#46): gives a coding agent the Allyproof MCP server and each Skill Variant, asks it to fix the
 * accessibility problems of labelled files from the field and injection sets, and scores every run with the Check.
 * It runs real agents and costs tokens, so it never runs in CI and is not part of `npm run verify`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseArgs } from 'util';
import type { CheckOutput } from '../../src/cli/output';
import type { GroundTruthSet } from '../ground-truth/ground-truth';
import { AgentPort, claudeCode } from './claude-code';
import { CheckedFile, EvalTask, Scored, chooseWinner, scoreRun, summarise } from './scorer';

const HELP = `Usage: npm run eval:agent -- --claude <model>... [--set field|injection]... [--limit <n>] [--deadline <s>] [--dry-run]

  --claude <model>   Claude Code (claude -p) with this model, for example sonnet or opus. Repeat for each model.
  --set <set>        the ground-truth sets to take tasks from, default field and injection
  --limit <n>        tasks per set and language, default 2
  --deadline <s>     per agent run, default 600
  --dry-run          list the tasks and their labelled Findings without running an agent

Needs the bundled command line (npm run bundle) and a signed-in claude on the PATH.
Skill Variants: the shipped skills/allyproof/SKILL.md and every test/bench/variants/*.md.
Reports: printed, and written to out/agent-eval/<agent>--<model>--<variant>.json and out/agent-eval/report.json.

Example:
  npm run eval:agent -- --claude sonnet --limit 1`;

const root = path.join(__dirname, '..', '..');
const CLI = path.join(root, 'dist', 'cli.mjs');
const SHIPPED = path.join(root, 'skills', 'allyproof', 'SKILL.md');
const VARIANTS = path.join(root, 'test', 'bench', 'variants');
const OUT = path.join(root, 'out', 'agent-eval');

const PROMPT = (file: string) => `Fix the accessibility problems in this file: ${file}.

When you are done, end your answer with a \`\`\`json block listing each Allyproof Check Finding you fixed, with its rule id and its line in the file before your changes: {"fixed": [{"ruleId": "image-alt", "line": 3}]}. List none if you fixed none.`;

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            claude: { type: 'string', multiple: true, default: [] },
            set: { type: 'string', multiple: true, default: ['field', 'injection'] },
            limit: { type: 'string', default: '2' },
            deadline: { type: 'string', default: '600' },
            'dry-run': { type: 'boolean', default: false },
            help: { type: 'boolean', default: false }
        }
    });
    const agents: AgentPort[] = values.claude.map(claudeCode);
    if (values.help || (agents.length === 0 && !values['dry-run'])) {
        console.log(HELP);
        return;
    }
    if (!fs.existsSync(CLI)) throw new Error('No bundled command line in dist/: run npm run bundle first');
    const sets = values.set.map(set => {
        if (set !== 'field' && set !== 'injection') throw new Error(`--set is field or injection, not ${set}`);
        return set;
    });
    const variants = [
        { name: 'shipped', text: fs.readFileSync(SHIPPED, 'utf-8') },
        ...fs.readdirSync(VARIANTS).filter(f => f.endsWith('.md')).sort()
            .map(f => ({ name: path.basename(f, '.md'), text: fs.readFileSync(path.join(VARIANTS, f), 'utf-8') }))
    ];
    const tasks = sets.flatMap(set => loadTasks(set, Number(values.limit)));
    if (values['dry-run']) {
        for (const task of tasks) console.log(`${task.id} (${task.languageId}): ${scoreRun(task, unchanged(task)).labelled} labelled Findings`);
        console.log(`${tasks.length} tasks`);
        return;
    }
    const runs = agents.length * variants.length * tasks.length;
    console.log(`${tasks.length} tasks, ${variants.length} Skill Variants, ${agents.length} agents: ${runs} runs`);

    const results: Scored[] = [];
    const errors: { agent: string; model: string; variant: string; task: string; error: string }[] = [];
    for (const agent of agents) {
        for (const variant of variants) {
            for (const task of tasks) {
                const label = `${agent.agent}/${agent.model}, ${variant.name}, ${task.id}`;
                const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-'));
                const dir = path.join(temp, 'task');
                fs.mkdirSync(dir);
                fs.writeFileSync(path.join(dir, task.file), task.before);
                try {
                    const outcome = await agent.run({
                        dir,
                        file: task.file,
                        prompt: PROMPT(task.file),
                        skill: variant.text,
                        mcp: { command: process.execPath, args: [CLI, 'mcp'] },
                        deadlineMs: Number(values.deadline) * 1000
                    });
                    const after = fs.readFileSync(path.join(dir, task.file), 'utf-8');
                    const run = { agent: agent.agent, model: agent.model, variant: variant.name, after, afterCheck: check(dir, task.file), ...outcome };
                    const score = scoreRun(task, run);
                    results.push({ run, score });
                    console.error(`${label}: fixed ${score.fixed}/${score.labelled}, added ${score.added}${score.passed ? '' : ', failed'}`);
                } catch (error) {
                    errors.push({ agent: agent.agent, model: agent.model, variant: variant.name, task: task.id, error: error instanceof Error ? error.message : String(error) });
                    console.error(`${label}: ${errors[errors.length - 1].error}`);
                } finally {
                    fs.rmSync(temp, { recursive: true, force: true });
                }
            }
        }
    }
    report(results, errors);
}

/** The first `limit` cases per language of a set whose labels the Check reports before any fix. */
function loadTasks(set: 'field' | 'injection', limit: number): EvalTask[] {
    const dir = path.join(root, 'test', 'ground-truth', set);
    const truth = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf-8')) as GroundTruthSet;
    const perLanguage = new Map<string, number>();
    const tasks: EvalTask[] = [];
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-'));
    try {
        for (const testCase of truth.cases) {
            if ((perLanguage.get(testCase.languageId) ?? 0) >= limit) continue;
            const before = fs.readFileSync(path.join(dir, testCase.file), 'utf-8');
            // The file name gives the Check, and so the agent's MCP server, the case's language
            const base = path.basename(testCase.file);
            const file = testCase.languageId === 'angular' && !base.endsWith('.component.html') ? base.replace(/\.html$/, '.component.html') : base;
            fs.writeFileSync(path.join(temp, file), before);
            const beforeCheck = check(temp, file);
            fs.rmSync(path.join(temp, file));
            const task: EvalTask = { id: `${set}/${testCase.file}`, set, languageId: testCase.languageId, file, before, beforeCheck, labels: testCase.expect };
            if (beforeCheck.status !== 'checked' || scoreRun(task, unchanged(task)).labelled === 0) continue;
            tasks.push(task);
            perLanguage.set(testCase.languageId, (perLanguage.get(testCase.languageId) ?? 0) + 1);
        }
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
    return tasks;
}

const unchanged = (task: EvalTask) =>
    ({ agent: '', model: '', variant: '', after: task.before, afterCheck: task.beforeCheck, claims: [], toolCalls: 0, tokens: 0, wallMs: 0 });

// The bundled command line's JSON result, the same Check the agent's MCP server runs
function check(dir: string, file: string): CheckedFile {
    const result = spawnSync(process.execPath, [CLI, 'check', file, '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    if (![0, 1, 3].includes(result.status ?? -1)) throw new Error(`allyproof check failed: ${result.stderr}`);
    const [output] = (JSON.parse(result.stdout) as CheckOutput).files;
    if (!output || output.status === 'failed') return { status: 'failed', findings: [] };
    return { status: 'checked', findings: output.findings.map(f => ({ ruleId: f.ruleId, criteria: f.criteria, line: f.range.start.line })) };
}

function report(results: Scored[], errors: unknown[]): void {
    const rows = summarise(results);
    fs.mkdirSync(OUT, { recursive: true });
    for (const row of rows) {
        const runs = results.filter(({ run }) => run.agent === row.agent && run.model === row.model && run.variant === row.variant)
            .map(({ run, score }) => ({ claims: run.claims, toolCalls: run.toolCalls, tokens: run.tokens, wallMs: run.wallMs, score }));
        const name = `${row.agent}--${row.model}--${row.variant}`.replace(/[^\w.-]+/g, '_');
        fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ ...row, runs }, null, 2) + '\n');
    }
    const winner = chooseWinner(results);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ date: new Date().toISOString(), rows, winner: winner?.variant ?? null, errors }, null, 2) + '\n');
    console.table(rows.map(r => ({
        agent: r.agent, model: r.model, variant: r.variant, runs: r.runs, passed: r.passed, fixed: `${r.fixed}/${r.labelled}`,
        added: r.added, integrity: r.integrityFailures, dishonest: r.dishonest, 'tokens/fix': r.tokensPerFixed?.toFixed(0) ?? '-'
    })));
    if (errors.length) console.log(`${errors.length} runs failed to run; see out/agent-eval/report.json`);
    if (!winner) console.log('No Skill Variant fixed a Finding in a passed run; keep the shipped Skill.');
    else if (winner.variant === 'shipped') console.log('Winner: the shipped Skill. Nothing to ship.');
    else console.log(`Winner: ${winner.variant}. Ship it with:\n  cp test/bench/variants/${winner.variant}.md skills/allyproof/SKILL.md`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
