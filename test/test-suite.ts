import * as axe from 'axe-core';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PROMPT_STRATEGIES, getPromptStrategy } from '../src/ai/prompt-strategies';
import { parseAIAnalysis, AIParsedViolation } from '../src/ai/ai-response-parser';
import { normalizeRuleIds, normalizeRuleId } from '../src/core/rule-id-normalizer';

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
}

class OpenRouterAPI {
    private key = (process.env.OPENROUTER_API_KEY || '').trim();
    private useStructured = (process.env.AI_STRUCTURED || '1') !== '0';
    private useCaching = (process.env.AI_CACHE || '0') === '1';
    private structuredUnsupported = new Set<string>(); // Modelle bei denen response_format fehlschlug
    public async analyze(prompt: string, model: string): Promise<{ content: string; tokens: number }> {
        if (!this.key) {
            console.warn('[AI] OPENROUTER_API_KEY fehlt – AI Test übersprungen.');
            return { content: '[]', tokens: 0 };
        }
        try {
            // Prompt Aufteilung: großer statischer Code-Block (cache_control) + Instruktion
            const [staticPart, instructionPart] = this.splitPrompt(prompt);
            const messages: any[] = [
                {
                    role: 'user',
                    content: this.useCaching ? [
                        { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
                        { type: 'text', text: instructionPart }
                    ] : staticPart
                }
            ];

            const body: any = {
                model,
                messages,
                temperature: 0,
            };
            if (this.useStructured && !this.structuredUnsupported.has(model)) {
                body.response_format = {
                    type: 'json_schema',
                    json_schema: {
                        name: 'wcag_violations',
                        strict: true,
                        schema: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    line: { type: 'integer', description: 'Line number in source (1-based)' },
                                    element: { type: 'string', description: 'HTML tag or component name' },
                                    issue: { type: 'string', description: 'Short description of the accessibility issue' },
                                    recommendation: { type: 'string', description: 'Suggested fix' },
                                    ruleId: { type: 'string', description: 'WCAG success criterion or rule identifier' }
                                },
                                required: ['line','ruleId'],
                                additionalProperties: false
                            }
                        }
                    }
                };
            }
            // Timeout Handling für Hänger
            const controller = new AbortController();
            const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || '45000', 10);
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'HTTP-Referer': 'https://github.com/NotAisu/Accessibility_Extension',
                    'X-Title': 'Accessibility Extension Test Suite'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeout);
            if (!response.ok) {
                // Falls Modell structured outputs nicht unterstützt → einmalig deaktivieren und Fallback ohne response_format
                if (this.useStructured && response.status === 400 && !this.structuredUnsupported.has(model)) {
                    this.structuredUnsupported.add(model);
                    console.warn(`[AI] Structured outputs nicht unterstützt für Modell ${model} – Fallback.`);
                    return this.analyze(prompt, model);
                }
                const text = await response.text();
                console.error(`[AI] OpenRouter HTTP ${response.status}: ${text}`);
                return { content: '[]', tokens: 0 };
            }
            const data = await response.json();
            let content = data.choices?.[0]?.message?.content;
            if (content && typeof content !== 'string') {
                // Structured Output liefert Objekt → in String serialisieren
                content = JSON.stringify(content);
            }
            return { content: content || '[]', tokens: data.usage?.total_tokens || 0 };
        } catch (e) {
            console.error('[AI] Request Fehler:', e);
            return { content: '[]', tokens: 0 };
        }
    }

    private splitPrompt(full: string): [string,string] {
        const marker = 'Antworte NUR als JSON';
        const idx = full.indexOf(marker);
        if (idx === -1) return [full, ''];
        return [full.slice(0, idx).trim(), full.slice(idx).trim()];
    }
}

export class TestSuite {
    private api = new OpenRouterAPI();
    private readonly TEST_FILES = [
        'wcag-violations.html',
        'wcag-violations.jsx',
        'wcag-violations.tsx',
        'wcag-violations.vue',
        'wcag-violations.svelte',
        'no-violations.html'
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
            const start = Date.now();
            const content = this.loadFile(file);
            const violations = await this.realAxeTest(content, file);
            const result: TestResult = {
                file,
                mode: 'axe',
                found: violations.length,
                expected: 0, // Ground Truth nicht für Axe
                timeMs: Date.now() - start,
                tokens: 0,
                details: violations.map(v => `axeId=${v.id} impact=${v.impact} desc=${v.description}`)
            };
            results.push(result);
            console.log(`✓ ${file} [axe] Found=${result.found} t=${result.timeMs}ms`);
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
                    const runStrategy = async (strategyName: string) => {
                        const start = Date.now();
                        const content = this.loadFile(file);
                        const ai = await this.aiTest(content, strategyName, model);
                        // Nur valide (line + ruleId) berücksichtigen – leere ruleIds verfälschen sonst Metriken
                        const predictedKeys = new Set(
                            ai.violations
                                .filter(v => v.ruleId && v.ruleId.trim() && typeof v.line === 'number' && v.line > 0)
                                .map(v => `${v.line}|${v.ruleId!.trim()}`)
                        );
                        const metrics = this.calcMetricsKeys(expectedKeys, predictedKeys);
                        const result: TestResult = {
                            file,
                            mode: 'ai',
                            strategy: strategyName,
                            run,
                            provider: 'OpenRouter',
                            model,
                            found: predictedKeys.size,
                            expected: expectedKeys.size,
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
                        console.log(`✓ ${file} (${strategyName}) [${model}] P=${metrics.precision.toFixed(2)} R=${metrics.recall.toFixed(2)} F1=${metrics.f1.toFixed(2)} TP=${metrics.tp} FP=${metrics.fp} FN=${metrics.fn} Found=${result.found}/${result.expected} t=${result.timeMs}ms tok=${result.tokens}`);
                    };
                    const onlyStrategiesEnv = (process.env.AI_STRATEGIES || '').trim();
                    const activeStrategies = onlyStrategiesEnv ? 
                        PROMPT_STRATEGIES.filter(s => onlyStrategiesEnv.split(',').map(x=>x.trim()).includes(s.name)) : 
                        PROMPT_STRATEGIES;
                    for (const strategy of activeStrategies) {
                        await runStrategy(strategy.name); // strikt nacheinander
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
        // Cache Axe Violations pro (run,model,file) damit nicht jede Strategie erneut scannt
        const axeCache = new Map<string, any[]>();
        for (let run = 1; run <= runs; run++) {
            if (runs > 1) console.log(`Run ${run}/${runs}`);
            for (const model of this.MODELS) {
                console.log(`  • Model: ${model}`);
                for (const file of this.TEST_FILES) {
                    const expectedList = this.loadExpected(file);
                    const expectedKeys = new Set(expectedList.map(v => `${v.line}|${v.ruleId}`));
                    const runStrategy = async (strategyName: string) => {
                        const start = Date.now();
                        const content = this.loadFile(file);
                        // AI Ergebnisse (für Ground Truth Metriken)
                        const aiResult = await this.aiTest(content, strategyName, model);
                        const aiKeys = new Set<string>(
                            aiResult.violations
                                .filter(v => v.ruleId && v.ruleId.trim() && typeof v.line === 'number' && v.line > 0)
                                .map(v => `${v.line}|${v.ruleId!.trim()}`)
                        );
                        // Axe Ergebnisse (nur zum Vergleich, keine Ground Truth Nutzung) – aus Cache
                        const axeKey = `${run}|${model}|${file}`;
                        let axeViolations = axeCache.get(axeKey);
                        if (!axeViolations) {
                            axeViolations = await this.realAxeTest(content, file);
                            axeCache.set(axeKey, axeViolations);
                        }
                        const duplicates = this.computeDuplicates(aiResult.violations, axeViolations);
                        
                        // ECHTE UNION: AI ∪ Axe Line-Mapping
                        const axeLineKeys = this.mapAxeLineKeys(content, axeViolations);
                        const combinedKeys = new Set<string>([...aiKeys, ...axeLineKeys]);
                        
                        // Metriken für AI-only und Combined
                        const aiMetrics = this.calcMetricsKeys(expectedKeys, aiKeys);
                        const combinedMetrics = this.calcMetricsKeys(expectedKeys, combinedKeys);
                        const deltaRecall = combinedMetrics.recall - aiMetrics.recall;
                        const axeAddedTP = [...combinedKeys].filter(k => !aiKeys.has(k) && expectedKeys.has(k)).length;
                        
                        const details: string[] = [
                            `duplicates=${duplicates.length}`,
                            `aiRecall=${aiMetrics.recall.toFixed(3)}`,
                            `combinedRecall=${combinedMetrics.recall.toFixed(3)}`,
                            `deltaRecall=${deltaRecall.toFixed(3)}`,
                            `axeAddedTP=${axeAddedTP}`,
                            ...duplicates.map(d => `DUPLICATE rule=${d}`),
                            ...aiResult.violations.map(v => `AI line=${v.line} rule=${v.ruleId} issue=${v.issue}`),
                            ...axeViolations.map(v => `AXE rule=${v.id}`)
                        ];
                        const result: TestResult = {
                            file,
                            mode: 'combined',
                            strategy: strategyName,
                            run,
                            provider: 'OpenRouter',
                            model,
                            found: combinedKeys.size,  // UNION statt nur AI
                            expected: expectedKeys.size,
                            timeMs: Date.now() - start,
                            tokens: aiResult.tokens,
                            details,
                            precision: combinedMetrics.precision,
                            recall: combinedMetrics.recall,
                            f1: combinedMetrics.f1,
                            tp: combinedMetrics.tp,
                            fp: combinedMetrics.fp,
                            fn: combinedMetrics.fn
                        };
                        results.push(result);
                        console.log(`✓ ${file} (${strategyName}) [combined ${model}] dup=${duplicates.length} ΔR=${deltaRecall.toFixed(3)} P=${combinedMetrics.precision.toFixed(2)} R=${combinedMetrics.recall.toFixed(2)} F1=${combinedMetrics.f1.toFixed(2)} Found=${result.found}/${result.expected} t=${result.timeMs}ms tok=${result.tokens}`);
                    };
                    const onlyStrategiesEnv = (process.env.AI_STRATEGIES || '').trim();
                    const activeStrategies = onlyStrategiesEnv ? 
                        PROMPT_STRATEGIES.filter(s => onlyStrategiesEnv.split(',').map(x=>x.trim()).includes(s.name)) : 
                        PROMPT_STRATEGIES;
                    for (const strategy of activeStrategies) {
                        await runStrategy(strategy.name);
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
            const parsed = JSON.parse(raw) as any[];
            const valid: ExpectedViolation[] = [];
            let invalidCount = 0;
            for (const entry of parsed) {
                if (entry && typeof entry.line === 'number' && entry.line > 0 && typeof entry.ruleId === 'string' && entry.ruleId.trim()) {
                    valid.push({ line: entry.line, ruleId: entry.ruleId});
                } else {
                    invalidCount++;
                }
            }
            if (invalidCount > 0) {
                console.warn(`[GT] ${filename}: ${invalidCount} ungültige Ground-Truth Einträge ignoriert (fehlende line/ruleId).`);
            }
            return valid;
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
            
            // Canvas getContext überschreiben (jsdom wirft sonst Not Implemented). Minimales measureText Stub.
            try {
                window.HTMLCanvasElement.prototype.getContext = function() { return { measureText: () => ({ width: 0 }) } as any; };
            } catch {}

            const results = await axe.run(window.document.documentElement, {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
                resultTypes: ['violations'],
            });

            return results.violations || [];
        } catch (error) {
            console.error(`Axe test error for ${filename}: ${error}`);
            return [];
        }
    }

    // (alter Parser entfernt, Nutzung des gemeinsamen Parsers parseAIAnalysis)

    private deduplicate(axeDetails: string[], aiDetails: string[]): string[] {
        return Array.from(new Set([...axeDetails, ...aiDetails]));
    }

    private computeDuplicates(aiViolations: AIParsedViolation[], axeViolations: any[]): string[] {
        // Einfache Heuristik: gleicher ruleId String
        const axeIds = new Set(axeViolations.map(v => v.id));
        const dups = new Set<string>();
        for (const v of aiViolations) {
            if (v.ruleId && axeIds.has(v.ruleId)) dups.add(v.ruleId);
        }
        return Array.from(dups);
    }
    
    /**
     * Heuristisches Zeilen-Mapping für axe Violations zur Bildung von line|ruleId Keys.
     * Sucht das erste HTML Fragment oder Tag im Original-Content.
     * Limitationen (Mehrfach-Vorkommen, transformierte Wrapper) werden in der Methodik dokumentiert.
     */
    private mapAxeLineKeys(originalContent: string, axeViolations: any[]): Set<string> {
        const content = originalContent;
        const lines = content.split('\n');
        const lineStartIdx: number[] = []; let acc = 0;
        for (const l of lines) { lineStartIdx.push(acc); acc += l.length + 1; }
        const findLine = (index: number) => {
            let low = 0, high = lineStartIdx.length - 1;
            while (low <= high) {
                const mid = (low + high) >> 1;
                const start = lineStartIdx[mid];
                const next = mid + 1 < lineStartIdx.length ? lineStartIdx[mid+1] : Infinity;
                if (start <= index && index < next) return mid + 1; // 1-based
                if (index < start) high = mid - 1; else low = mid + 1;
            }
            return 0;
        };
        const keys = new Set<string>();
        for (const v of axeViolations) {
            const rule = v.id || '';
            if (!rule || !Array.isArray(v.nodes)) continue;
            for (const n of v.nodes) {
                const frag: string | undefined = n.html;
                if (!frag) continue;
                const cleaned = frag.replace(/\s+/g, ' ').trim();
                if (!cleaned) continue;
                const primary = cleaned.slice(0, 120);
                let idx = content.indexOf(primary);
                if (idx === -1) {
                    const tagMatch = cleaned.match(/<([a-zA-Z0-9-]+)/);
                    if (tagMatch) idx = content.indexOf(tagMatch[0]);
                }
                if (idx !== -1) {
                    const line = findLine(idx);
                    if (line > 0) keys.add(`${line}|${rule}`);
                }
            }
        }
        return keys;
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
                        const violations = normalizeRuleIds(
                                parseAIAnalysis(response.content)
                                    .filter(v => typeof v.line === 'number' && v.line > 0)
                        );
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
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const csvPath = path.join(resultsDir, `${mode}-${timestamp}.csv`);
        const headers = ['file', 'mode', 'strategy', 'run', 'provider', 'model', 'found', 'expected', 'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'timeMs', 'tokens', 'details'];
        const escape = (val: any) => {
            const s = String(val);
            if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes(';')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };
        const rows = results.map(r => headers.map(h => {
            switch (h) {
                case 'file': return escape(r.file);
                case 'mode': return escape(r.mode);
                case 'strategy': return escape(r.strategy || '');
                case 'run': return escape(r.run ?? '');
                case 'provider': return escape(r.provider || '');
                case 'model': return escape(r.model || '');
                case 'found': return escape(r.found);
                case 'expected': return escape(r.expected);
                case 'tp': return escape(r.tp ?? '');
                case 'fp': return escape(r.fp ?? '');
                case 'fn': return escape(r.fn ?? '');
                case 'precision': return escape(r.precision?.toFixed(3) || '');
                case 'recall': return escape(r.recall?.toFixed(3) || '');
                case 'f1': return escape(r.f1?.toFixed(3) || '');
                case 'timeMs': return escape(r.timeMs);
                case 'tokens': return escape(r.tokens);
                case 'details': return escape(r.details.join('; '));
                default: return '';
            }
        }));
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
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
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const summaryPath = path.join(resultsDir, `${mode}-summary-${timestamp}.csv`);
        fs.writeFileSync(summaryPath, rows.map(r=>r.join(',')).join('\n'));
    console.log(`\n📊 Summary (${mode}) saved: ${summaryPath}`);
    }
}

