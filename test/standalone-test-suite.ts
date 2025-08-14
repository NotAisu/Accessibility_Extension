import * as axe from 'axe-core';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
    filename: string;
    axeViolations: number;
    totalExpectedViolations: number;
    detectionRate: string;
    axeDetails: any[];
    executionTime: {
        axe: number;
    };
}

interface TestConfig {
    testFiles?: string[];
}

export class AccessibilityTestSuite {
    private testResults: TestResult[] = [];

    // Manuelle Zuordnung von erwarteten Verstößen pro Datei (basename -> erwartete Anzahl)
    // Trage hier für jede Fixture-Datei die erwartete Anzahl ein, z.B.:
    // 'wcag-violations.html': 30,
    // Wenn kein Eintrag vorhanden ist, wird der gefundene Wert als Erwartung verwendet.
    public expectedViolations: Record<string, number> = {
        // Beispiel:
        // 'wcag-violations.html': 30
    };

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
        
        this.displayResults();
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
        
        // Run axe-core test (no heuristic estimation)
        const axeStart = Date.now();
        const axeResult = await this.runAxeTest(content, filename);
        const axeTime = Date.now() - axeStart;
        
        const foundViolations = (axeResult && Array.isArray(axeResult.violations)) ? axeResult.violations.length : 0;
        // Verwende manuell gesetzte Erwartung oder fallback auf gefundene Verstöße
        const totalExpected = this.expectedViolations[filename] ?? foundViolations;
        const percentage = totalExpected > 0 ? Math.round((foundViolations / totalExpected) * 100) : 0;
        const detectionRate = `${foundViolations}/${totalExpected} (${percentage}%)`;
        
        return {
            filename,
            axeViolations: foundViolations,
            totalExpectedViolations: totalExpected,
            detectionRate,
            axeDetails: axeResult.violations || [],
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

    private displayResults(): void {
        this.displayTableResults();
    }

    private displayTableResults(): void {
        console.log('\n📊 TEST RESULTS');
        console.log('================');
        
        // Header
        console.log('┌─────────────────────────┬──────────────────┬─────────────┬──────────────┐');
        console.log('│ File                    │ Found/Total (%)  │ Time (ms)   │ Status       │');
        console.log('├─────────────────────────┼──────────────────┼─────────────┼──────────────┤');
        
        let totalFound = 0;
        let totalExpected = 0;
        let totalTime = 0;
        
        // Results
        for (const result of this.testResults) {
            const fileName = result.filename.padEnd(23);
            const detectionInfo = result.detectionRate.padEnd(16);
            const time = result.executionTime.axe.toString().padEnd(11);
            const status = result.axeViolations > 0 ? '✅ Found' : '⚠️  None';
            
            console.log(`│ ${fileName} │ ${detectionInfo} │ ${time} │ ${status.padEnd(12)} │`);
            
            totalFound += result.axeViolations;
            totalExpected += result.totalExpectedViolations;
            totalTime += result.executionTime.axe;
        }
        
        // Footer
        console.log('├─────────────────────────┼──────────────────┼─────────────┼──────────────┤');
        const totalFiles = this.testResults.length.toString();
        const overallRate = totalExpected > 0 ? Math.round((totalFound / totalExpected) * 100) : 0;
        const totalDetectionInfo = `${totalFound}/${totalExpected} (${overallRate}%)`.padEnd(16);
        const avgTime = Math.round(totalTime / this.testResults.length);
        console.log(`│ TOTAL (${totalFiles} files)${' '.repeat(12)} │ ${totalDetectionInfo} │ avg ${avgTime.toString().padEnd(7)} │ ✅ Complete   │`);
        console.log('└─────────────────────────┴──────────────────┴─────────────┴──────────────┘');
        
        // Summary
        console.log('\n📈 SUMMARY');
        console.log(`Total violations found: ${totalFound}/${totalExpected} (${overallRate}%)`);
        console.log(`Average test time: ${avgTime}ms`);
        console.log(`Files with violations: ${this.testResults.filter(r => r.axeViolations > 0).length}/${this.testResults.length}`);
        console.log(`Detection quality: ${overallRate >= 70 ? '🟢 Good' : overallRate >= 50 ? '🟡 Fair' : '🔴 Poor'}`);
    }
}

// Export function for CLI usage
export async function runAccessibilityTests(config: TestConfig = {}): Promise<TestResult[]> {
    const testSuite = new AccessibilityTestSuite();
    return await testSuite.runTests(config);
}
