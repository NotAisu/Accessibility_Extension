/**
 * The local AI benchmark: scores every Skill Variant on every model and names the Variant that ships.
 * It sends code to the models and costs tokens, so it never runs in CI.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseArgs } from 'util';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
import { selectLocalModel } from '../../src/review/local-model';
import { BenchCase, BenchResult, MIN_PRECISION, Variant, chooseWinner, runBenchmark, sampleCases, totals } from './benchmark';
import { accessGuruCases, actWrapperCases } from './data';

const HELP = `Usage: npm run bench -- [--local <model>[@<endpoint>]]... [--copilot] [--deadline <s>] [--limit <n>]

  --local <model>[@<endpoint>]  a model on an OpenAI-compatible server; the endpoint defaults to LM Studio,
                                http://localhost:1234/v1 (Ollama: http://localhost:11434/v1). Repeat for each model.
  --copilot                     the first Copilot chat model, in a VS Code window with its own profile in
                                .vscode-test/b that gets Copilot Chat installed. On the first run sign in to GitHub
                                Copilot there and allow Allyproof to use the model.
  --deadline <s>                per model request, default 300
  --limit <n>                   at most n stratified cases from each set, to try a setup

Skill Variants: the shipped skills/allyproof/SKILL.md and every test/bench/variants/*.md.
Results: printed, and written to out/bench/results.json.

Example:
  npm run bench -- --local qwen2.5-coder-7b-instruct --local llama3.1:8b@http://localhost:11434/v1 --copilot`;

const root = path.join(__dirname, '..', '..');
const LM_STUDIO = 'http://localhost:1234/v1';
const SHIPPED = path.join(root, 'skills', 'allyproof', 'SKILL.md');
const VARIANTS = path.join(__dirname, 'variants');

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            local: { type: 'string', multiple: true, default: [] },
            copilot: { type: 'boolean', default: false },
            deadline: { type: 'string', default: '300' },
            limit: { type: 'string' },
            help: { type: 'boolean', default: false }
        }
    });
    if (values.help || (values.local.length === 0 && !values.copilot)) {
        console.log(HELP);
        return;
    }
    const deadlineMs = Number(values.deadline) * 1000;
    const limit = values.limit === undefined ? Infinity : Number(values.limit);
    const cases = [...sampleCases(await accessGuruCases(), limit), ...sampleCases(actWrapperCases(), limit)];
    const variants: Variant[] = [
        { name: 'shipped', text: fs.readFileSync(SHIPPED, 'utf-8') },
        ...fs.readdirSync(VARIANTS).filter(f => f.endsWith('.md')).sort()
            .map(f => ({ name: path.basename(f, '.md'), text: fs.readFileSync(path.join(VARIANTS, f), 'utf-8') }))
    ];
    console.log(`${cases.length} cases (${cases.filter(c => c.synthetic).length} synthetic), ${variants.length} Skill Variants`);

    const models = [];
    for (const local of values.local) {
        const [model, endpoint = LM_STUDIO] = local.split('@');
        models.push(await selectLocalModel({ endpoint, model }));
    }
    const log = (line: string) => process.stderr.write(`${line}\n`);
    const results = await runBenchmark(cases, variants, models, { deadlineMs, log });
    if (values.copilot) results.push(...await copilot(cases, variants, deadlineMs));

    report(results);
    const out = path.join(root, 'out', 'bench');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({
        date: new Date().toISOString(),
        winner: chooseWinner(results) ?? null,
        results,
        totals: totals(results)
    }, null, 2) + '\n');
}

function report(results: BenchResult[]): void {
    const score = (value: number | null) => value === null ? '-' : value.toFixed(3);
    console.table(results.map(r => ({ variant: r.variant, model: r.model, recall: score(r.recall), precision: score(r.precision), tokens: r.tokens, errors: r.errors })));
    console.table(totals(results).map(s => ({ variant: s.variant, recall: score(s.recall), precision: score(s.precision), tokens: s.tokens, errors: s.errors })));
    const winner = chooseWinner(results);
    if (!winner) {
        console.log(`No Variant reaches a precision of ${MIN_PRECISION} over all models; keep the shipped Skill.`);
    } else if (winner.variant === 'shipped') {
        console.log('Winner: the shipped Skill. Nothing to ship.');
    } else {
        console.log(`Winner: ${winner.variant}. Ship it with:\n  cp test/bench/variants/${winner.variant}.md skills/allyproof/SKILL.md`);
    }
}

// vscode.lm exists only in an extension host, so the Copilot run happens in a VS Code window
async function copilot(cases: BenchCase[], variants: Variant[], deadlineMs: number): Promise<BenchResult[]> {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
    try {
        const out = path.join(root, 'out', 'bench', 'host');
        await esbuild.build({
            entryPoints: { 'copilot-host': path.join(__dirname, 'copilot-host.ts') },
            outdir: out,
            outExtension: { '.js': '.cjs' },
            bundle: true,
            platform: 'node',
            format: 'cjs',
            external: ['vscode'],
            logLevel: 'warning'
        });
        const input = path.join(temp, 'input.json');
        const output = path.join(temp, 'output.json');
        fs.writeFileSync(input, JSON.stringify({ cases, variants, deadlineMs }));
        const executable = await downloadAndUnzipVSCode('stable');
        // A profile of its own that keeps the Copilot sign-in between runs; short, as VS Code's IPC socket path must be
        const profile = path.join(root, '.vscode-test', 'b');
        const dirs = [`--user-data-dir=${path.join(profile, 'u')}`, `--extensions-dir=${path.join(profile, 'x')}`];
        const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
        spawnSync(cli, [...cliArgs, ...dirs, '--install-extension', 'GitHub.copilot-chat'], { stdio: 'inherit', shell: process.platform === 'win32' });
        const child = spawn(executable, [
            `--extensionDevelopmentPath=${root}`,
            `--extensionTestsPath=${path.join(out, 'copilot-host.cjs')}`,
            ...dirs,
            '--disable-updates',
            '--skip-welcome',
            '--skip-release-notes'
        ], { env: { ...process.env, ALLYPROOF_BENCH_INPUT: input, ALLYPROOF_BENCH_OUTPUT: output }, stdio: 'inherit' });
        const code = await new Promise<number | null>((resolve, reject) => {
            child.on('error', reject);
            child.on('exit', resolve);
        });
        if (code !== 0 || !fs.existsSync(output)) throw new Error(`The Copilot benchmark window failed with exit code ${code}`);
        return JSON.parse(fs.readFileSync(output, 'utf-8')) as BenchResult[];
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
