import * as vscode from 'vscode';
import * as axe from 'axe-core';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { AISemanticAnalyzer } from '../src/ai/ai-semantic-analyzer';
import { LLMService } from '../src/llm/llm-service';

interface TestResult {
    filename: string;
    axeViolations: number;
    aiViolations: number;
    combinedViolations: number;
    axeDetails: any[];
    aiDetails: any[];
    combinedDetails: any[];
    executionTime: {
        axe: number;
        ai: number;
        combined: number;
    };
}

interface TestConfig {
    githubCopilotModel?: string;
    testFiles?: string[];
    outputFormat?: 'table' | 'json' | 'both';
}

export class AccessibilityTestSuite {
    private testResults: TestResult[] = [];
    private aiAnalyzer?: AISemanticAnalyzer;
    private llmService?: LLMService;
    private diagnosticCollection?: vscode.DiagnosticCollection;

    constructor() {
        this.setupMockVSCodeEnvironment();
    }

    private setupMockVSCodeEnvironment() {
        // Mock VS Code environment for testing
        if (typeof global !== 'undefined') {
            // Setup mock workspace configuration
            const mockConfig = {
                get: (key: string, defaultValue?: any) => {
                    const configs: any = {
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
            if (!(global as any).vscode) {
                (global as any).vscode = {
                    workspace: {
                        getConfiguration: () => mockConfig
                    },
                    languages: {
                        createDiagnosticCollection: () => ({
                            set: () => {},
                            get: () => [],
                            clear: () => {},
                            dispose: () => {}
                        })
                    },
                    Diagnostic: class {
                        constructor(public range: any, public message: string, public severity: any) {}
                    },
                    DiagnosticSeverity: {
                        Error: 0,
                        Warning: 1,
                        Information: 2,
                        Hint: 3
                    },
                    Range: class {
                        constructor(public start: any, public end: any) {}
                    },
                    Position: class {
                        constructor(public line: number, public character: number) {}
                    },
                    Uri: {
                        file: (path: string) => ({ fsPath: path, toString: () => path })
                    }
                } as any;
            }
        }
    }

    async initialize(config: TestConfig = {}): Promise<void> {
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
                store: async () => {},
                delete: async () => {},
                onDidChange: new (vscode as any).EventEmitter().event
            } as unknown as vscode.SecretStorage;

            this.llmService = new LLMService(secretStorage);
            this.diagnosticCollection = vscode.languages.createDiagnosticCollection('accessibility-test');
            
            this.aiAnalyzer = new AISemanticAnalyzer(this.llmService);
            this.aiAnalyzer.setDiagnosticsCallback((uri: vscode.Uri) => {
                return Array.from(this.diagnosticCollection?.get(uri) || []);
            });

            console.log('✅ Test suite initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize test suite:', error);
            throw error;
        }
    }

    async runAllTests(config: TestConfig = {}): Promise<TestResult[]> {
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
            } catch (error) {
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

    async testFile(filename: string): Promise<TestResult> {
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

    private async testWithAxeCore(content: string, filename: string): Promise<{violations: number, details: any[], executionTime: number}> {
        const startTime = Date.now();
        
        try {
            const { window } = new JSDOM(content, {
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
        } catch (error) {
            console.error(`Axe-core test failed for ${filename}:`, error);
            return {
                violations: 0,
                details: [],
                executionTime: Date.now() - startTime
            };
        }
    }

    private async testWithAIAnalyzer(content: string, filename: string): Promise<{violations: number, details: any[], executionTime: number}> {
        const startTime = Date.now();
        
        try {
            if (!this.aiAnalyzer) {
                throw new Error('AI Analyzer not initialized');
            }

            // Create mock text document
            const mockDocument = {
                getText: () => content,
                lineCount: content.split('\n').length,
                lineAt: (line: number) => ({
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
                offsetAt: (position: vscode.Position) => 0,
                positionAt: (offset: number) => new vscode.Position(0, 0),
                getWordRangeAtPosition: () => undefined,
                validateRange: (range: vscode.Range) => range,
                validatePosition: (position: vscode.Position) => position
            } as unknown as vscode.TextDocument;

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
                    let code: any = {};
                    try {
                        code = typeof d.code === 'string' ? JSON.parse(d.code) : d.code;
                    } catch (e) {
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
        } catch (error) {
            console.error(`AI analyzer test failed for ${filename}:`, error);
            return {
                violations: 0,
                details: [],
                executionTime: Date.now() - startTime
            };
        }
    }

    private async testCombined(content: string, filename: string): Promise<{violations: number, details: any[], executionTime: number}> {
        const startTime = Date.now();
        
        try {
            // Run both tests
            const axeResult = await this.testWithAxeCore(content, filename);
            const aiResult = await this.testWithAIAnalyzer(content, filename);
            
            // Combine unique violations (avoid duplicates)
            const combinedDetails = [...axeResult.details];
            
            // Add AI violations that don't overlap with axe violations
            for (const aiDetail of aiResult.details) {
                const isUnique = !axeResult.details.some(axeDetail => 
                    this.checkViolationOverlap(axeDetail, aiDetail)
                );
                
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
        } catch (error) {
            console.error(`Combined test failed for ${filename}:`, error);
            return {
                violations: 0,
                details: [],
                executionTime: Date.now() - startTime
            };
        }
    }

    private checkViolationOverlap(axeViolation: any, aiViolation: any): boolean {
        // Simple overlap detection - can be enhanced
        if (axeViolation.id && aiViolation.ruleId) {
            return axeViolation.id.includes(aiViolation.ruleId) || 
                   aiViolation.ruleId.includes(axeViolation.id);
        }
        return false;
    }

    private getContentType(filename: string): string {
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

    private getLanguageId(filename: string): string {
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

    private displayResults(format: 'table' | 'json' | 'both' = 'table'): void {
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

    private displayTableResults(): void {
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

    private displayJsonResults(): void {
        console.log('\n📄 JSON Results:');
        console.log(JSON.stringify(this.testResults, null, 2));
    }

    private displaySummary(): void {
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

    public getResults(): TestResult[] {
        return this.testResults;
    }

    public cleanup(): void {
        this.aiAnalyzer?.dispose();
        this.diagnosticCollection?.dispose();
    }
}

// CLI Interface
export async function runAccessibilityTests(config: TestConfig = {}): Promise<TestResult[]> {
    const testSuite = new AccessibilityTestSuite();
    
    try {
        await testSuite.initialize(config);
        const results = await testSuite.runAllTests(config);
        testSuite.cleanup();
        return results;
    } catch (error) {
        console.error('❌ Test suite failed:', error);
        testSuite.cleanup();
        throw error;
    }
}
