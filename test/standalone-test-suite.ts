import * as axe from 'axe-core';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
    filename: string;
    axeViolations: number;
    axeDetails: any[];
    executionTime: {
        axe: number;
    };
    totalExpectedViolations?: number;
    detectionRate?: string;
}

interface TestConfig {
    testFiles?: string[];
    outputFormat?: 'table' | 'json' | 'both';
}

export class AccessibilityTestSuite {
    private testResults: TestResult[] = [];

    constructor() {
        // No VS Code dependencies needed for standalone testing
    }

    public async runTests(config: TestConfig = {}): Promise<TestResult[]> {
        console.log('🚀 Starting WCAG 2.2 AA Accessibility Test Suite');
        console.log('================================================');
        
        // Get the correct fixtures directory path - look in source, not compiled output
        const fixturesDir = path.resolve(process.cwd(), 'test', 'fixtures');
        const testFiles = config.testFiles || this.getTestFiles(fixturesDir);
        
        console.log(`📁 Found ${testFiles.length} test files`);
        
        this.testResults = [];
        
        for (const file of testFiles) {
            console.log(`\n🔍 Testing: ${path.basename(file)}`);
            const result = await this.runSingleFileTest(file);
            this.testResults.push(result);
        }
        
        this.displayResults(config.outputFormat || 'table');
        return this.testResults;
    }

    private getTestFiles(fixturesDir: string): string[] {
        console.log(`Looking for test files in: ${fixturesDir}`);
        
        if (!fs.existsSync(fixturesDir)) {
            console.error(`❌ Fixtures directory not found: ${fixturesDir}`);
            return [];
        }
        
        const files = fs.readdirSync(fixturesDir);
        const testFiles = files
            .filter(file => file.startsWith('wcag-violations.') && 
                           (file.endsWith('.html') || file.endsWith('.jsx') || 
                            file.endsWith('.tsx') || file.endsWith('.vue') || 
                            file.endsWith('.svelte')))
            .map(file => path.join(fixturesDir, file));
            
        console.log(`Found test files: ${testFiles.map(f => path.basename(f)).join(', ')}`);
        return testFiles;
    }

    private async runSingleFileTest(filePath: string): Promise<TestResult> {
        const filename = path.basename(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Run axe-core test
        const axeStart = Date.now();
        const axeResult = await this.runAxeTest(content, filename);
        const axeTime = Date.now() - axeStart;
        
        return {
            filename,
            axeViolations: axeResult.violations.length,
            axeDetails: axeResult.violations,
            executionTime: {
                axe: axeTime
            }
        };
    }

    private async runAxeTest(content: string, filename: string): Promise<any> {
        try {
            // Setup JSDOM
            const dom = new JSDOM(content, {
                pretendToBeVisual: true,
                resources: 'usable'
            });
            
            const { window } = dom;
            
            // Setup HTMLCanvasElement mock for axe-core
            if (!window.HTMLCanvasElement.prototype.getContext) {
                window.HTMLCanvasElement.prototype.getContext = function() {
                    return null;
                };
            }

            // Run axe-core analysis
            const results = await axe.run(window.document.documentElement, {
                runOnly: { 
                    type: 'tag', 
                    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] 
                },
                resultTypes: ['violations'],
                rules: {
                    'color-contrast': { enabled: false },
                    'color-contrast-enhanced': { enabled: false }
                }
            });

            return results;
        } catch (error) {
            console.error(`❌ Error testing ${filename}:`, error);
            return { violations: [] };
        }
    }

    private displayResults(format: 'table' | 'json' | 'both'): void {
        if (format === 'table' || format === 'both') {
            this.displayTableResults();
        }
        
        if (format === 'json' || format === 'both') {
            this.displayJsonResults();
        }
    }

    private displayTableResults(): void {
        console.log('\n📊 TEST RESULTS');
        console.log('================');
        
        // Header
        console.log('┌─────────────────────────┬──────────────┬─────────────┬──────────────┐');
        console.log('│ File                    │ Axe-Core     │ Time (ms)   │ Status       │');
        console.log('├─────────────────────────┼──────────────┼─────────────┼──────────────┤');
        
        let totalViolations = 0;
        let totalTime = 0;
        
        // Results
        for (const result of this.testResults) {
            const fileName = result.filename.padEnd(23);
            const axeCount = result.axeViolations.toString().padEnd(12);
            const time = result.executionTime.axe.toString().padEnd(11);
            const status = result.axeViolations > 0 ? '✅ Found' : '⚠️  None';
            
            console.log(`│ ${fileName} │ ${axeCount} │ ${time} │ ${status.padEnd(12)} │`);
            
            totalViolations += result.axeViolations;
            totalTime += result.executionTime.axe;
        }
        
        // Footer
        console.log('├─────────────────────────┼──────────────┼─────────────┼──────────────┤');
        const totalFiles = this.testResults.length.toString();
        const avgTime = Math.round(totalTime / this.testResults.length);
        console.log(`│ TOTAL (${totalFiles} files)${' '.repeat(12)} │ ${totalViolations.toString().padEnd(12)} │ avg ${avgTime.toString().padEnd(7)} │ ✅ Complete   │`);
        console.log('└─────────────────────────┴──────────────┴─────────────┴──────────────┘');
        
        // Summary
        console.log('\n📈 SUMMARY');
        console.log(`Total violations found: ${totalViolations}`);
        console.log(`Average test time: ${avgTime}ms`);
        console.log(`Files with violations: ${this.testResults.filter(r => r.axeViolations > 0).length}/${this.testResults.length}`);
    }

    private displayJsonResults(): void {
        console.log('\n📄 JSON Results:');
        console.log(JSON.stringify({
            summary: {
                totalFiles: this.testResults.length,
                totalViolations: this.testResults.reduce((sum, r) => sum + r.axeViolations, 0),
                averageTime: Math.round(this.testResults.reduce((sum, r) => sum + r.executionTime.axe, 0) / this.testResults.length)
            },
            results: this.testResults
        }, null, 2));
    }
}

// Export function for CLI usage
export async function runAccessibilityTests(config: TestConfig = {}): Promise<TestResult[]> {
    const testSuite = new AccessibilityTestSuite();
    return await testSuite.runTests(config);
}
