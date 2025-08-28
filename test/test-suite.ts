import * as axe from 'axe-core';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PROMPT_STRATEGIES, getPromptStrategy } from '../src/ai/prompt-strategies';
import { parseAIAnalysis, AIParsedViolation } from '../src/ai/ai-response-parser';

dotenv.config();

dotenv.config();

interface TestResult {
    file: string;
    mode: 'axe' | 'ai' | 'combined';
    strategy?: string; // Prompt-Strategie (nur AI / Combined)
    provider?: string; // AI Provider (z.B. OpenRouter)
    model?: string;    // Modell-ID
    run?: number;      // Lauf (für Mehrfachläufe)
    found: number;
    expected: number;
    rate: string;      // Prozentual (XX%)
    timeMs: number;
    tokens: number;
    details: string[]; // Textuelle Details
    precision?: number;
    recall?: number;
    f1?: number;
    tp?: number;
    fp?: number;
    fn?: number;
}

interface ExpectedViolation {
    line: number;
    ruleId: string;
    element: string;
}

class OpenRouterAPI {
    private key = process.env.OPENROUTER_API_KEY!;
    public async analyze(prompt: string, model: string): Promise<{ content: string; tokens: number }> {
        if (!this.key) {
            return { content: '[]', tokens: 0 };
        }
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
            }),
        });
        const data = await response.json();
        return {
            content: data.choices[0]?.message?.content || '',
            tokens: data.usage?.total_tokens || 0,
        };
    }
}

export class TestSuite {
    private api = new OpenRouterAPI();
    private readonly TEST_FILES = [
        'wcag-violations.html',
        'wcag-violations.jsx',
        'wcag-violations.tsx',
        'wcag-violations.vue',
        'wcag-violations.svelte'
    ];
    private readonly MODELS: string[] = (process.env.AI_MODELS || process.env.OPENROUTER_DEFAULT_MODEL || 'qwen/qwen3-coder:free')
        .split(',')
        .map(m => m.trim())
        .filter(Boolean);

    private getRuns(): number {
        const r = parseInt(process.env.AI_RUNS || '1', 10);
        return isNaN(r) || r < 1 ? 1 : r;
    }

    async runAxe(): Promise<TestResult[]> {
        console.log('🔍 Running Axe-Core Tests...\n');
        const results: TestResult[] = [];
        
        for (const file of this.TEST_FILES) {
            const expected = this.loadExpected(file).length;
            const start = Date.now();
            const content = this.loadFile(file);
            const violations = await this.realAxeTest(content, file);
            
            const result: TestResult = {
                file,
                mode: 'axe',
                found: violations.length,
                expected,
                rate: `${Math.round((violations.length / expected) * 100)}%`,
                timeMs: Date.now() - start,
                tokens: 0,
                details: violations.map(v => `${v.id}: ${v.description}`)
            };
            
            results.push(result);
            console.log(`✓ ${file}: ${result.found}/${result.expected} (${result.rate}) - ${result.timeMs}ms`);
        }
        
        await this.saveCSV(results, 'axe');
        return results;
    }

    async runAI(): Promise<TestResult[]> {
        console.log('\n🤖 Running AI Tests...\n');
        const results: TestResult[] = [];
        const runs = this.getRuns();
        for (let run = 1; run <= runs; run++) {
            if (runs > 1) console.log(`Run ${run}/${runs}`);
            for (const model of this.MODELS) {
                console.log(`  • Model: ${model}`);
                for (const file of this.TEST_FILES) {
                    const expectedList = this.loadExpected(file);
                    const expectedKeys = new Set(expectedList.map(v => `${v.line}|${v.ruleId}`));
                    for (const strategy of PROMPT_STRATEGIES) {
                        const start = Date.now();
                        const content = this.loadFile(file);
                        const ai = await this.aiTest(content, strategy.name, model);
                        const predictedKeys = new Set(ai.violations.map(v => `${v.line}|${v.ruleId || ''}`));
                        const metrics = this.calcMetricsKeys(expectedKeys, predictedKeys);
                        const result: TestResult = {
                            file,
                            mode: 'ai',
                            strategy: strategy.name,
                            run,
                            provider: 'OpenRouter',
                            model,
                            found: predictedKeys.size,
                            expected: expectedKeys.size,
                            rate: `${Math.round((predictedKeys.size / Math.max(1, expectedKeys.size)) * 100)}%`,
                            timeMs: Date.now() - start,
                            tokens: ai.tokens,
                            details: ai.violations.map(v => `line=${v.line} rule=${v.ruleId} elem=${v.element} issue=${v.issue}`),
                            precision: metrics.precision,
                            recall: metrics.recall,
                            f1: metrics.f1,
                            tp: metrics.tp,
                            fp: metrics.fp,
                            fn: metrics.fn
                        };
                        results.push(result);
                        console.log(`✓ ${file} (${strategy.name}) [${model}] P=${metrics.precision.toFixed(2)} R=${metrics.recall.toFixed(2)} F1=${metrics.f1.toFixed(2)} TP=${metrics.tp} FP=${metrics.fp} FN=${metrics.fn} Found=${result.found}/${result.expected} (${result.rate}) t=${result.timeMs}ms tok=${result.tokens}`);
                    }
                }
            }
        }
        await this.saveCSV(results, 'ai');
        this.saveSummary(results, 'ai');
        return results;
    }

    async runCombined(): Promise<TestResult[]> {
        console.log('\n🚀 Running Combined Tests...\n');
        const results: TestResult[] = [];
        const runs = this.getRuns();
        for (let run = 1; run <= runs; run++) {
            if (runs > 1) console.log(`Run ${run}/${runs}`);
            for (const model of this.MODELS) {
                console.log(`  • Model: ${model}`);
                for (const file of this.TEST_FILES) {
                    const expectedList = this.loadExpected(file);
                    const expectedKeys = new Set(expectedList.map(v => `${v.line}|${v.ruleId}`));
                    for (const strategy of PROMPT_STRATEGIES) {
                        const start = Date.now();
                        const content = this.loadFile(file);
                        const [axeViolations, aiResult] = await Promise.all([
                            this.realAxeTest(content, file),
                            this.aiTest(content, strategy.name, model)
                        ]);
                        // Combined: axe rule IDs (no line mapping) + AI (line+rule)
                        const predictedKeys = new Set<string>();
                        aiResult.violations.forEach(v => predictedKeys.add(`${v.line}|${v.ruleId || ''}`));
                        const metrics = this.calcMetricsKeys(expectedKeys, predictedKeys);
                        const result: TestResult = {
                            file,
                            mode: 'combined',
                            strategy: strategy.name,
                            run,
                            provider: 'OpenRouter',
                            model,
                            found: predictedKeys.size,
                            expected: expectedKeys.size,
                            rate: `${Math.round((predictedKeys.size / Math.max(1, expectedKeys.size)) * 100)}%`,
                            timeMs: Date.now() - start,
                            tokens: aiResult.tokens,
                            details: aiResult.violations.map(v => `line=${v.line} rule=${v.ruleId} elem=${v.element} issue=${v.issue}`),
                            precision: metrics.precision,
                            recall: metrics.recall,
                            f1: metrics.f1,
                            tp: metrics.tp,
                            fp: metrics.fp,
                            fn: metrics.fn
                        };
                        results.push(result);
                        console.log(`✓ ${file} (${strategy.name}) [combined ${model}] P=${metrics.precision.toFixed(2)} R=${metrics.recall.toFixed(2)} F1=${metrics.f1.toFixed(2)} TP=${metrics.tp} FP=${metrics.fp} FN=${metrics.fn} Found=${result.found}/${result.expected} (${result.rate}) t=${result.timeMs}ms tok=${result.tokens}`);
                    }
                }
            }
        }
        await this.saveCSV(results, 'combined');
        this.saveSummary(results, 'combined');
        return results;
    }

    private loadFile(filename: string): string {
        const filePath = path.resolve(__dirname, '..', '..', 'test', 'fixtures', filename);
        return fs.readFileSync(filePath, 'utf-8');
    }

    private loadExpected(filename: string): ExpectedViolation[] {
        const expectedPath = path.resolve(__dirname, '..', '..', 'test', 'expected', `${filename}.json`);
        try {
            const raw = fs.readFileSync(expectedPath, 'utf-8');
            return JSON.parse(raw) as ExpectedViolation[];
        } catch {
            return [];
        }
    }

    /**
     * Echtes axe-core Testing wie in der Extension
     */
    private async realAxeTest(content: string, filename: string): Promise<any[]> {
        try {
            // Für non-HTML Dateien, wrappen wir in HTML für axe-core
            let htmlContent = content;
            if (!filename.endsWith('.html')) {
                htmlContent = this.wrapInHTML(content, filename);
            }

            const { window } = new JSDOM(htmlContent, { pretendToBeVisual: true, resources: 'usable' });
            
            // Canvas fix wie in der Extension
            if (!window.HTMLCanvasElement.prototype.getContext) {
                window.HTMLCanvasElement.prototype.getContext = () => null;
            }

            const results = await axe.run(window.document.documentElement, {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
                resultTypes: ['violations'],
                rules: {
                    'color-contrast': { enabled: false },
                    'color-contrast-enhanced': { enabled: false }
                }
            });

            return results.violations || [];
        } catch (error) {
            console.error(`Axe test error for ${filename}: ${error}`);
            return [];
        }
    }

    // (alter Parser entfernt, Nutzung des gemeinsamen Parsers parseAIAnalysis)

    private deduplicate(axeViolations: any[], aiDetails: string[]): string[] {
        const axeItems = axeViolations.map(v => `Axe: ${v.id}`);
        const aiItems = aiDetails.map(d => `AI: ${d}`);
        
        // Simple deduplication by unique strings
        const allItems = [...axeItems, ...aiItems];
        return Array.from(new Set(allItems));
    }

    /**
     * Wrappe JSX/TSX/Vue/Svelte Content in HTML für axe-core
     */
    private wrapInHTML(content: string, filename: string): string {
        if (filename.endsWith('.html')) {
            return content;
        }

        // Für JSX/TSX, extrahiere JSX und konvertiere zu HTML-ähnlich
        if (filename.endsWith('.jsx') || filename.endsWith('.tsx')) {
            const jsxContent = this.extractJSXElements(content);
            return `<!DOCTYPE html><html><head><title>Test</title></head><body>${jsxContent}</body></html>`;
        }

        // Für Vue, extrahiere Template
        if (filename.endsWith('.vue')) {
            const templateContent = this.extractVueTemplate(content);
            return `<!DOCTYPE html><html><head><title>Test</title></head><body>${templateContent}</body></html>`;
        }

        // Für Svelte, extrahiere HTML Teil
        if (filename.endsWith('.svelte')) {
            const htmlContent = this.extractSvelteHTML(content);
            return `<!DOCTYPE html><html><head><title>Test</title></head><body>${htmlContent}</body></html>`;
        }

        return content;
    }

    private extractJSXElements(content: string): string {
        // Vereinfachte JSX zu HTML Konvertierung
        let html = content;
        
        // Entferne Imports, Exports, Functions
        html = html.replace(/^import.*$/gm, '');
        html = html.replace(/^export.*$/gm, '');
        html = html.replace(/const\s+\w+.*?=.*?=>\s*\{/g, '');
        html = html.replace(/function\s+\w+.*?\{/g, '');
        
        // Finde JSX Return statements
        const jsxMatch = html.match(/return\s*\(([\s\S]*?)\);?\s*}/);
        if (jsxMatch) {
            html = jsxMatch[1];
        }
        
        // JSX zu HTML conversions
        html = html.replace(/className=/g, 'class=');
        html = html.replace(/\{[^}]*\}/g, ''); // Remove JS expressions
        
        return html.trim();
    }

    private extractVueTemplate(content: string): string {
        const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
        return templateMatch ? templateMatch[1].trim() : '';
    }

    private extractSvelteHTML(content: string): string {
        // Entferne Script und Style Blöcke
        let html = content.replace(/<script[\s\S]*?<\/script>/g, '');
        html = html.replace(/<style[\s\S]*?<\/style>/g, '');
        return html.trim();
    }

    private async aiTest(content: string, strategyName: string, model: string): Promise<{ violations: AIParsedViolation[]; tokens: number }> {
        try {
            const strategy = getPromptStrategy(strategyName);
            const prompt = strategy.generatePrompt(this.addLineNumbers(content)) + '\n\nAntworte NUR als JSON Array von Objekten im Format: [{"line": <number>, "element": "<tag>", "issue": "<kurz>", "recommendation": "<fix>", "ruleId": "<wcag/rule>"}]';
            const response = await this.api.analyze(prompt, model);
            const violations = parseAIAnalysis(response.content)
                .filter(v => typeof v.line === 'number' && v.line > 0);
            return { violations, tokens: response.tokens };
        } catch (error) {
            return { violations: [], tokens: 0 };
        }
    }

    private addLineNumbers(content: string): string {
        return content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
    }

    private async saveCSV(results: TestResult[], mode: string): Promise<void> {
        const resultsDir = path.resolve(__dirname, '..', '..', 'test', 'results');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const csvPath = path.join(resultsDir, `${mode}-${timestamp}.csv`);
        const headers = ['file', 'mode', 'strategy', 'run', 'provider', 'model', 'found', 'expected', 'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'rate', 'timeMs', 'tokens', 'details'];
        const rows = results.map(r => [
            r.file,
            r.mode,
            r.strategy || '',
            r.run ?? '',
            r.provider || '',
            r.model || '',
            r.found,
            r.expected,
            r.tp ?? '',
            r.fp ?? '',
            r.fn ?? '',
            r.precision?.toFixed(3) || '',
            r.recall?.toFixed(3) || '',
            r.f1?.toFixed(3) || '',
            r.rate,
            r.timeMs,
            r.tokens,
            `"${r.details.join('; ')}"`
        ]);

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        fs.writeFileSync(csvPath, csv);
        console.log(`\n💾 Results saved: ${csvPath}`);
    }

    private calcMetricsKeys(expected: Set<string>, predicted: Set<string>) {
        let tp = 0;
        predicted.forEach(k => { if (expected.has(k)) tp++; });
        const fp = predicted.size - tp;
        const fn = expected.size - tp;
        const precision = predicted.size === 0 ? 0 : tp / predicted.size;
        const recall = expected.size === 0 ? 0 : tp / expected.size;
        const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
        return { precision, recall, f1, tp, fp, fn };
    }

    private saveSummary(results: TestResult[], mode: string) {
        const grouped = new Map<string, TestResult[]>();
        for (const r of results) {
            const key = `${r.file}|${r.mode}|${r.strategy}|${r.model}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(r);
        }
        const rows: string[][] = [];
        rows.push(['file','mode','strategy','model','runs','found_mean','found_std','precision_mean','precision_std','recall_mean','recall_std','f1_mean','f1_std']);
        const stat = (vals: number[]) => {
            if (vals.length === 0) return { mean: 0, std: 0 };
            const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
            const variance = vals.length > 1 ? vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/(vals.length-1) : 0;
            return { mean, std: Math.sqrt(variance) };
        };
        grouped.forEach((arr, key) => {
            const [file, m, strategy, model] = key.split('|');
            const foundStats = stat(arr.map(a=>a.found));
            const pStats = stat(arr.map(a=>a.precision||0));
            const rStats = stat(arr.map(a=>a.recall||0));
            const fStats = stat(arr.map(a=>a.f1||0));
            rows.push([
                file,
                m,
                strategy || '',
                model || '',
                String(arr.length),
                foundStats.mean.toFixed(2),
                foundStats.std.toFixed(2),
                pStats.mean.toFixed(3),
                pStats.std.toFixed(3),
                rStats.mean.toFixed(3),
                rStats.std.toFixed(3),
                fStats.mean.toFixed(3),
                fStats.std.toFixed(3)
            ]);
        });
        const resultsDir = path.resolve(__dirname, '..', '..', 'test', 'results');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const summaryPath = path.join(resultsDir, `${mode}-summary-${timestamp}.csv`);
        fs.writeFileSync(summaryPath, rows.map(r=>r.join(',')).join('\n'));
        console.log(`📊 Summary saved: ${summaryPath}`);
    }
}
