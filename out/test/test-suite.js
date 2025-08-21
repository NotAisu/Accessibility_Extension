"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestSuite = void 0;
const axe = __importStar(require("axe-core"));
const jsdom_1 = require("jsdom");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const prompt_strategies_1 = require("../src/ai/prompt-strategies");
dotenv.config();
dotenv.config();
class OpenRouterAPI {
    constructor() {
        this.key = process.env.OPENROUTER_API_KEY;
        this.model = process.env.OPENROUTER_DEFAULT_MODEL || 'qwen/qwen-2.5-coder-32b-instruct';
    }
    async analyze(prompt) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
            }),
        });
        const data = await response.json();
        return {
            content: data.choices[0]?.message?.content || '',
            tokens: data.usage?.total_tokens || 0,
        };
    }
}
class TestSuite {
    constructor() {
        this.api = new OpenRouterAPI();
        this.expected = {
            'wcag-violations.html': 37,
            'wcag-violations.jsx': 5,
            'wcag-violations.tsx': 5,
            'wcag-violations.vue': 37,
            'wcag-violations.svelte': 37,
        };
    }
    async runAxe() {
        console.log('🔍 Running Axe-Core Tests...\n');
        const results = [];
        for (const [file, expected] of Object.entries(this.expected)) {
            const start = Date.now();
            const content = this.loadFile(file);
            const violations = await this.realAxeTest(content, file);
            const result = {
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
    async runAI() {
        console.log('\n🤖 Running AI Tests...\n');
        const results = [];
        for (const [file, expected] of Object.entries(this.expected)) {
            for (const strategy of prompt_strategies_1.PROMPT_STRATEGIES) {
                const start = Date.now();
                const content = this.loadFile(file);
                const violations = await this.aiTest(content, strategy.name);
                const result = {
                    file,
                    mode: 'ai',
                    strategy: strategy.name,
                    found: violations.violations,
                    expected,
                    rate: `${Math.round((violations.violations / expected) * 100)}%`,
                    timeMs: Date.now() - start,
                    tokens: violations.tokens,
                    details: violations.details
                };
                results.push(result);
                console.log(`✓ ${file} (${strategy.name}): ${result.found}/${result.expected} (${result.rate}) - ${result.timeMs}ms, ${result.tokens} tokens`);
            }
        }
        await this.saveCSV(results, 'ai');
        return results;
    }
    async runCombined() {
        console.log('\n🚀 Running Combined Tests...\n');
        const results = [];
        for (const [file, expected] of Object.entries(this.expected)) {
            for (const strategy of prompt_strategies_1.PROMPT_STRATEGIES) {
                const start = Date.now();
                const content = this.loadFile(file);
                // Run both tests
                const [axeViolations, aiResult] = await Promise.all([
                    this.realAxeTest(content, file),
                    this.aiTest(content, strategy.name)
                ]);
                // Combine and deduplicate
                const combined = this.deduplicate(axeViolations, aiResult.details);
                const result = {
                    file,
                    mode: 'combined',
                    strategy: strategy.name,
                    found: combined.length,
                    expected,
                    rate: `${Math.round((combined.length / expected) * 100)}%`,
                    timeMs: Date.now() - start,
                    tokens: aiResult.tokens,
                    details: combined
                };
                results.push(result);
                console.log(`✓ ${file} (${strategy.name}): ${result.found}/${result.expected} (${result.rate}) - ${result.timeMs}ms, ${result.tokens} tokens`);
            }
        }
        await this.saveCSV(results, 'combined');
        return results;
    }
    loadFile(filename) {
        const filePath = path.resolve(__dirname, '..', '..', 'test', 'fixtures', filename);
        return fs.readFileSync(filePath, 'utf-8');
    }
    /**
     * Echtes axe-core Testing wie in der Extension
     */
    async realAxeTest(content, filename) {
        try {
            // Für non-HTML Dateien, wrappen wir in HTML für axe-core
            let htmlContent = content;
            if (!filename.endsWith('.html')) {
                htmlContent = this.wrapInHTML(content, filename);
            }
            const { window } = new jsdom_1.JSDOM(htmlContent, { pretendToBeVisual: true, resources: 'usable' });
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
        }
        catch (error) {
            console.error(`Axe test error for ${filename}: ${error}`);
            return [];
        }
    }
    parseAIResponse(response) {
        const violations = [];
        // Extract JSON violations
        const jsonPattern = /\{[^}]*"line"[^}]*\}/g;
        const matches = response.match(jsonPattern) || [];
        for (const match of matches) {
            try {
                const parsed = JSON.parse(match);
                if (parsed.issue && parsed.line) {
                    violations.push(`Line ${parsed.line}: ${parsed.issue}`);
                }
            }
            catch { }
        }
        return violations;
    }
    deduplicate(axeViolations, aiDetails) {
        const axeItems = axeViolations.map(v => `Axe: ${v.id}`);
        const aiItems = aiDetails.map(d => `AI: ${d}`);
        // Simple deduplication by unique strings
        const allItems = [...axeItems, ...aiItems];
        return Array.from(new Set(allItems));
    }
    /**
     * Wrappe JSX/TSX/Vue/Svelte Content in HTML für axe-core
     */
    wrapInHTML(content, filename) {
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
    extractJSXElements(content) {
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
    extractVueTemplate(content) {
        const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
        return templateMatch ? templateMatch[1].trim() : '';
    }
    extractSvelteHTML(content) {
        // Entferne Script und Style Blöcke
        let html = content.replace(/<script[\s\S]*?<\/script>/g, '');
        html = html.replace(/<style[\s\S]*?<\/style>/g, '');
        return html.trim();
    }
    async aiTest(content, strategyName) {
        try {
            const strategy = (0, prompt_strategies_1.getPromptStrategy)(strategyName);
            const prompt = strategy.generatePrompt(this.addLineNumbers(content));
            const response = await this.api.analyze(prompt);
            const details = this.parseAIResponse(response.content);
            return {
                violations: details.length,
                tokens: response.tokens,
                details
            };
        }
        catch (error) {
            return { violations: 0, tokens: 0, details: [`Error: ${error}`] };
        }
    }
    addLineNumbers(content) {
        return content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
    }
    async saveCSV(results, mode) {
        const resultsDir = path.resolve(__dirname, '..', '..', 'test', 'results');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const csvPath = path.join(resultsDir, `${mode}-${timestamp}.csv`);
        const headers = ['file', 'mode', 'strategy', 'found', 'expected', 'rate', 'timeMs', 'tokens', 'details'];
        const rows = results.map(r => [
            r.file,
            r.mode,
            r.strategy || '',
            r.found,
            r.expected,
            r.rate,
            r.timeMs,
            r.tokens,
            `"${r.details.join('; ')}"`
        ]);
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        fs.writeFileSync(csvPath, csv);
        console.log(`\n💾 Results saved: ${csvPath}`);
    }
}
exports.TestSuite = TestSuite;
//# sourceMappingURL=test-suite.js.map