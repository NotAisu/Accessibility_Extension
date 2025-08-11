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
exports.AccessibilityTestSuite = void 0;
exports.runAccessibilityTests = runAccessibilityTests;
const vscode = __importStar(require("vscode"));
const axe = __importStar(require("axe-core"));
const jsdom_1 = require("jsdom");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ai_semantic_analyzer_1 = require("../src/ai/ai-semantic-analyzer");
const llm_service_1 = require("../src/llm/llm-service");
class AccessibilityTestSuite {
    constructor() {
        this.testResults = [];
        this.setupMockVSCodeEnvironment();
    }
    setupMockVSCodeEnvironment() {
        // Mock VS Code environment for testing
        if (typeof global !== 'undefined') {
            // Setup mock workspace configuration
            const mockConfig = {
                get: (key, defaultValue) => {
                    const configs = {
                        'accessibility.aiProvider': 'github-copilot',
                        'accessibility.githubCopilot.model': 'gpt-4o',
                        'accessibility.aiAnalyzer.enabled': true,
                        'accessibility.aiAnalyzer.scope': 'document'
                    };
                    return configs[key] || defaultValue;
                },
                update: () => Promise.resolve()
            };
            // Mock vscode workspace
            if (!global.vscode) {
                global.vscode = {
                    workspace: {
                        getConfiguration: () => mockConfig
                    },
                    languages: {
                        createDiagnosticCollection: () => ({
                            set: () => { },
                            get: () => [],
                            clear: () => { },
                            dispose: () => { }
                        })
                    },
                    Diagnostic: class {
                        constructor(range, message, severity) {
                            this.range = range;
                            this.message = message;
                            this.severity = severity;
                        }
                    },
                    DiagnosticSeverity: {
                        Error: 0,
                        Warning: 1,
                        Information: 2,
                        Hint: 3
                    },
                    Range: class {
                        constructor(start, end) {
                            this.start = start;
                            this.end = end;
                        }
                    },
                    Position: class {
                        constructor(line, character) {
                            this.line = line;
                            this.character = character;
                        }
                    },
                    Uri: {
                        file: (path) => ({ fsPath: path, toString: () => path })
                    }
                };
            }
        }
    }
    async initialize(config = {}) {
        try {
            // Set GitHub Copilot model if provided
            if (config.githubCopilotModel) {
                const vscodeConfig = vscode.workspace.getConfiguration('accessibility');
                await vscodeConfig.update('githubCopilot.model', config.githubCopilotModel);
                console.log(`🤖 GitHub Copilot model set to: ${config.githubCopilotModel}`);
            }
            // Initialize services
            const secretStorage = {
                get: async () => undefined,
                store: async () => { },
                delete: async () => { },
                onDidChange: new vscode.EventEmitter().event
            };
            this.llmService = new llm_service_1.LLMService(secretStorage);
            this.diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility-test');
            this.aiAnalyzer = new ai_semantic_analyzer_1.AISemanticAnalyzer(this.llmService);
            this.aiAnalyzer.setDiagnosticsCallback((uri) => {
                return Array.from(this.diagnosticCollection?.get(uri) || []);
            });
            console.log('✅ Test suite initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize test suite:', error);
            throw error;
        }
    }
    async runAllTests(config = {}) {
        const testFiles = config.testFiles || [
            'wcag-violations.html',
            'wcag-violations.jsx',
            'wcag-violations.tsx',
            'wcag-violations.vue',
            'wcag-violations.svelte'
        ];
        console.log('🚀 Starting WCAG 2.2 AA Accessibility Test Suite');
        console.log(`📁 Testing ${testFiles.length} files`);
        console.log('─'.repeat(80));
        for (const filename of testFiles) {
            try {
                const result = await this.testFile(filename);
                this.testResults.push(result);
                console.log(`✅ ${filename} - Completed`);
            }
            catch (error) {
                console.error(`❌ ${filename} - Failed:`, error);
                // Add failed result
                this.testResults.push({
                    filename,
                    axeViolations: 0,
                    aiViolations: 0,
                    combinedViolations: 0,
                    axeDetails: [],
                    aiDetails: [],
                    combinedDetails: [],
                    executionTime: { axe: 0, ai: 0, combined: 0 }
                });
            }
        }
        this.displayResults(config.outputFormat || 'table');
        return this.testResults;
    }
    async testFile(filename) {
        const filePath = path.join(__dirname, 'fixtures', filename);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Test file not found: ${filePath}`);
        }
        const content = fs.readFileSync(filePath, 'utf8');
        console.log(`📄 Testing: ${filename}`);
        // Test with axe-core only
        const axeResult = await this.testWithAxeCore(content, filename);
        // Test with AI analyzer only  
        const aiResult = await this.testWithAIAnalyzer(content, filename);
        // Test with combined approach
        const combinedResult = await this.testCombined(content, filename);
        return {
            filename,
            axeViolations: axeResult.violations,
            aiViolations: aiResult.violations,
            combinedViolations: combinedResult.violations,
            axeDetails: axeResult.details,
            aiDetails: aiResult.details,
            combinedDetails: combinedResult.details,
            executionTime: {
                axe: axeResult.executionTime,
                ai: aiResult.executionTime,
                combined: combinedResult.executionTime
            }
        };
    }
    async testWithAxeCore(content, filename) {
        const startTime = Date.now();
        try {
            const { window } = new jsdom_1.JSDOM(content, {
                contentType: this.getContentType(filename),
                pretendToBeVisual: true
            });
            // Mock canvas for axe-core
            if (!window.HTMLCanvasElement.prototype.getContext) {
                window.HTMLCanvasElement.prototype.getContext = () => null;
            }
            const results = await axe.run(window.document, {
                rules: {
                    // Enable all WCAG 2.2 AA rules
                    'color-contrast': { enabled: true },
                    'image-alt': { enabled: true },
                    'button-name': { enabled: true },
                    'link-name': { enabled: true },
                    'form-field-multiple-labels': { enabled: true },
                    'heading-order': { enabled: true },
                    'landmark-main-is-top-level': { enabled: true }
                }
            });
            const executionTime = Date.now() - startTime;
            return {
                violations: results.violations.length,
                details: results.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    description: v.description,
                    nodes: v.nodes.length,
                    help: v.help,
                    helpUrl: v.helpUrl
                })),
                executionTime
            };
        }
        catch (error) {
            console.error(`Axe-core test failed for ${filename}:`, error);
            return {
                violations: 0,
                details: [],
                executionTime: Date.now() - startTime
            };
        }
    }
    async testWithAIAnalyzer(content, filename) {
        const startTime = Date.now();
        try {
            if (!this.aiAnalyzer) {
                throw new Error('AI Analyzer not initialized');
            }
            // Create mock text document
            const mockDocument = {
                getText: () => content,
                lineCount: content.split('\n').length,
                lineAt: (line) => ({
                    text: content.split('\n')[line] || '',
                    range: new vscode.Range(line, 0, line, (content.split('\n')[line] || '').length)
                }),
                uri: vscode.Uri.file(path.join(__dirname, 'fixtures', filename)),
                languageId: this.getLanguageId(filename),
                version: 1,
                isDirty: false,
                isClosed: false,
                save: async () => true,
                eol: vscode.EndOfLine.LF,
                fileName: filename,
                isUntitled: false,
                // Additional required properties
                encoding: 'utf8',
                offsetAt: (position) => 0,
                positionAt: (offset) => new vscode.Position(0, 0),
                getWordRangeAtPosition: () => undefined,
                validateRange: (range) => range,
                validatePosition: (position) => position
            };
            // Enable AI analyzer
            this.aiAnalyzer.setEnabled(true);
            this.aiAnalyzer.setAnalysisScope('document');
            // Run AI analysis
            await this.aiAnalyzer.startAnalysis(mockDocument, []);
            // Get AI diagnostics
            const aiDiagnostics = this.aiAnalyzer.getAIDiagnostics(mockDocument.uri);
            const executionTime = Date.now() - startTime;
            return {
                violations: aiDiagnostics.length,
                details: Array.from(aiDiagnostics).map(d => {
                    let code = {};
                    try {
                        code = typeof d.code === 'string' ? JSON.parse(d.code) : d.code;
                    }
                    catch (e) {
                        code = { ruleId: 'unknown' };
                    }
                    return {
                        message: d.message,
                        ruleId: code.ruleId,
                        element: code.element,
                        recommendation: code.recommendation,
                        line: d.range.start.line + 1,
                        severity: d.severity
                    };
                }),
                executionTime
            };
        }
        catch (error) {
            console.error(`AI analyzer test failed for ${filename}:`, error);
            return {
                violations: 0,
                details: [],
                executionTime: Date.now() - startTime
            };
        }
    }
    async testCombined(content, filename) {
        const startTime = Date.now();
        try {
            // Run both tests
            const axeResult = await this.testWithAxeCore(content, filename);
            const aiResult = await this.testWithAIAnalyzer(content, filename);
            // Combine unique violations (avoid duplicates)
            const combinedDetails = [...axeResult.details];
            // Add AI violations that don't overlap with axe violations
            for (const aiDetail of aiResult.details) {
                const isUnique = !axeResult.details.some(axeDetail => this.checkViolationOverlap(axeDetail, aiDetail));
                if (isUnique) {
                    combinedDetails.push(aiDetail);
                }
            }
            const executionTime = Date.now() - startTime;
            return {
                violations: combinedDetails.length,
                details: combinedDetails,
                executionTime
            };
        }
        catch (error) {
            console.error(`Combined test failed for ${filename}:`, error);
            return {
                violations: 0,
                details: [],
                executionTime: Date.now() - startTime
            };
        }
    }
    checkViolationOverlap(axeViolation, aiViolation) {
        // Simple overlap detection - can be enhanced
        if (axeViolation.id && aiViolation.ruleId) {
            return axeViolation.id.includes(aiViolation.ruleId) ||
                aiViolation.ruleId.includes(axeViolation.id);
        }
        return false;
    }
    getContentType(filename) {
        const ext = path.extname(filename).toLowerCase();
        switch (ext) {
            case '.html': return 'text/html';
            case '.jsx': return 'text/html'; // For testing purposes
            case '.tsx': return 'text/html';
            case '.vue': return 'text/html';
            case '.svelte': return 'text/html';
            default: return 'text/html';
        }
    }
    getLanguageId(filename) {
        const ext = path.extname(filename).toLowerCase();
        switch (ext) {
            case '.html': return 'html';
            case '.jsx': return 'javascriptreact';
            case '.tsx': return 'typescriptreact';
            case '.vue': return 'vue';
            case '.svelte': return 'svelte';
            default: return 'html';
        }
    }
    displayResults(format = 'table') {
        console.log('\n' + '='.repeat(80));
        console.log('📊 WCAG 2.2 AA Accessibility Test Results');
        console.log('='.repeat(80));
        if (format === 'table' || format === 'both') {
            this.displayTableResults();
        }
        if (format === 'json' || format === 'both') {
            this.displayJsonResults();
        }
        this.displaySummary();
    }
    displayTableResults() {
        console.log('\n📋 Results Table:');
        console.log('┌─' + '─'.repeat(20) + '─┬─' + '─'.repeat(10) + '─┬─' + '─'.repeat(10) + '─┬─' + '─'.repeat(12) + '─┬─' + '─'.repeat(15) + '─┐');
        console.log('│ ' + 'Filename'.padEnd(20) + ' │ ' + 'Axe-Core'.padEnd(10) + ' │ ' + 'AI Only'.padEnd(10) + ' │ ' + 'Combined'.padEnd(12) + ' │ ' + 'Improvement %'.padEnd(15) + ' │');
        console.log('├─' + '─'.repeat(20) + '─┼─' + '─'.repeat(10) + '─┼─' + '─'.repeat(10) + '─┼─' + '─'.repeat(12) + '─┼─' + '─'.repeat(15) + '─┤');
        for (const result of this.testResults) {
            const improvement = result.axeViolations > 0
                ? Math.round(((result.combinedViolations - result.axeViolations) / result.axeViolations) * 100)
                : result.aiViolations > 0 ? 100 : 0;
            const filename = result.filename.length > 20
                ? result.filename.substring(0, 17) + '...'
                : result.filename;
            console.log('│ ' + filename.padEnd(20) + ' │ ' +
                result.axeViolations.toString().padEnd(10) + ' │ ' +
                result.aiViolations.toString().padEnd(10) + ' │ ' +
                result.combinedViolations.toString().padEnd(12) + ' │ ' +
                `+${improvement}%`.padEnd(15) + ' │');
        }
        console.log('└─' + '─'.repeat(20) + '─┴─' + '─'.repeat(10) + '─┴─' + '─'.repeat(10) + '─┴─' + '─'.repeat(12) + '─┴─' + '─'.repeat(15) + '─┘');
        // Performance Table
        console.log('\n⏱️  Performance Results (ms):');
        console.log('┌─' + '─'.repeat(20) + '─┬─' + '─'.repeat(10) + '─┬─' + '─'.repeat(10) + '─┬─' + '─'.repeat(12) + '─┐');
        console.log('│ ' + 'Filename'.padEnd(20) + ' │ ' + 'Axe-Core'.padEnd(10) + ' │ ' + 'AI Only'.padEnd(10) + ' │ ' + 'Combined'.padEnd(12) + ' │');
        console.log('├─' + '─'.repeat(20) + '─┼─' + '─'.repeat(10) + '─┼─' + '─'.repeat(10) + '─┼─' + '─'.repeat(12) + '─┤');
        for (const result of this.testResults) {
            const filename = result.filename.length > 20
                ? result.filename.substring(0, 17) + '...'
                : result.filename;
            console.log('│ ' + filename.padEnd(20) + ' │ ' +
                result.executionTime.axe.toString().padEnd(10) + ' │ ' +
                result.executionTime.ai.toString().padEnd(10) + ' │ ' +
                result.executionTime.combined.toString().padEnd(12) + ' │');
        }
        console.log('└─' + '─'.repeat(20) + '─┴─' + '─'.repeat(10) + '─┴─' + '─'.repeat(10) + '─┴─' + '─'.repeat(12) + '─┘');
    }
    displayJsonResults() {
        console.log('\n📄 JSON Results:');
        console.log(JSON.stringify(this.testResults, null, 2));
    }
    displaySummary() {
        const totalAxe = this.testResults.reduce((sum, r) => sum + r.axeViolations, 0);
        const totalAI = this.testResults.reduce((sum, r) => sum + r.aiViolations, 0);
        const totalCombined = this.testResults.reduce((sum, r) => sum + r.combinedViolations, 0);
        const totalFiles = this.testResults.length;
        const avgImprovement = totalAxe > 0
            ? Math.round(((totalCombined - totalAxe) / totalAxe) * 100)
            : totalAI > 0 ? 100 : 0;
        console.log('\n📈 Summary:');
        console.log(`🎯 Total files tested: ${totalFiles}`);
        console.log(`🔍 Total axe-core violations: ${totalAxe}`);
        console.log(`🤖 Total AI-only violations: ${totalAI}`);
        console.log(`🚀 Total combined violations: ${totalCombined}`);
        console.log(`📊 Average improvement: +${avgImprovement}%`);
        const uniqueAIViolations = totalCombined - totalAxe;
        console.log(`✨ Unique AI discoveries: ${uniqueAIViolations} violations`);
        if (uniqueAIViolations > 0) {
            console.log(`🎉 AI Semantic Analyzer found ${uniqueAIViolations} additional accessibility issues that axe-core missed!`);
        }
        console.log('\n🏁 Test suite completed successfully!');
    }
    getResults() {
        return this.testResults;
    }
    cleanup() {
        this.aiAnalyzer?.dispose();
        this.diagnosticCollection?.dispose();
    }
}
exports.AccessibilityTestSuite = AccessibilityTestSuite;
// CLI Interface
async function runAccessibilityTests(config = {}) {
    const testSuite = new AccessibilityTestSuite();
    try {
        await testSuite.initialize(config);
        const results = await testSuite.runAllTests(config);
        testSuite.cleanup();
        return results;
    }
    catch (error) {
        console.error('❌ Test suite failed:', error);
        testSuite.cleanup();
        throw error;
    }
}
//# sourceMappingURL=accessibility-test-suite.js.map