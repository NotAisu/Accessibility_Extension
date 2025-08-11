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
const axe = __importStar(require("axe-core"));
const jsdom_1 = require("jsdom");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class AccessibilityTestSuite {
    constructor() {
        this.testResults = [];
        // No VS Code dependencies needed for standalone testing
    }
    async runTests(config = {}) {
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
    getTestFiles(fixturesDir) {
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
    async runSingleFileTest(filePath) {
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
    async runAxeTest(content, filename) {
        try {
            // Setup JSDOM
            const dom = new jsdom_1.JSDOM(content, {
                pretendToBeVisual: true,
                resources: 'usable'
            });
            const { window } = dom;
            // Setup HTMLCanvasElement mock for axe-core
            if (!window.HTMLCanvasElement.prototype.getContext) {
                window.HTMLCanvasElement.prototype.getContext = function () {
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
        }
        catch (error) {
            console.error(`❌ Error testing ${filename}:`, error);
            return { violations: [] };
        }
    }
    displayResults(format) {
        if (format === 'table' || format === 'both') {
            this.displayTableResults();
        }
        if (format === 'json' || format === 'both') {
            this.displayJsonResults();
        }
    }
    displayTableResults() {
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
    displayJsonResults() {
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
exports.AccessibilityTestSuite = AccessibilityTestSuite;
// Export function for CLI usage
async function runAccessibilityTests(config = {}) {
    const testSuite = new AccessibilityTestSuite();
    return await testSuite.runTests(config);
}
//# sourceMappingURL=standalone-test-suite.js.map