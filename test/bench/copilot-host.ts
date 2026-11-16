// Entry point VS Code loads through --extensionTestsPath: benchmarks the Variants on the first Copilot chat model
// through the same port the AI Review uses, and writes the results for run.ts to read
import * as fs from 'fs';
import * as vscode from 'vscode';
import { selectCopilotModel } from '../../src/copilot-model';
import { BenchCase, Variant, runBenchmark } from './benchmark';

// Time to install Copilot, sign in and load its models on a first run
const MODEL_WAIT_MS = 10 * 60_000;

export async function run(): Promise<void> {
    const input = JSON.parse(fs.readFileSync(process.env.ALLYPROOF_BENCH_INPUT!, 'utf-8')) as { cases: BenchCase[]; variants: Variant[]; deadlineMs: number };
    const model = await waitForModel();
    void vscode.window.showInformationMessage(`Benchmarking ${model.name}. Allow Allyproof to use the model when asked.`);
    const results = await runBenchmark(input.cases, input.variants, [model], { deadlineMs: input.deadlineMs, log: line => console.log(line) });
    fs.writeFileSync(process.env.ALLYPROOF_BENCH_OUTPUT!, JSON.stringify(results));
}

async function waitForModel() {
    const until = Date.now() + MODEL_WAIT_MS;
    let asked = false;
    for (;;) {
        const model = await selectCopilotModel();
        if (model) return model;
        if (Date.now() > until) throw new Error('No Copilot chat model: sign in to GitHub Copilot in the benchmark window.');
        if (!asked) {
            asked = true;
            console.log('Waiting for a Copilot chat model: sign in to GitHub Copilot in the benchmark window.');
            void vscode.window.showInformationMessage('Sign in to GitHub Copilot so the Allyproof benchmark can use its model.');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
