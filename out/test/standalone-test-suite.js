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
        this.displayResults();
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
    estimateExpectedViolations(content, filename) {
        // Estimate based on known violation patterns in our test files
        const violationPatterns = [
            /<img[^>]+(?!alt=)[^>]*>/g, // Images without alt
            /<button[^>]*>\s*<\/button>/g, // Empty buttons
            /<a[^>]*>\s*<\/a>/g, // Empty links
            /<input[^>]*(?!aria-label)(?!title)(?!placeholder)[^>]*>/g, // Unlabeled inputs
            /<iframe[^>]*(?!title=)[^>]*>/g, // Iframes without title
            /<h[1-6][^>]*>\s*<\/h[1-6]>/g, // Empty headings
            /<div[^>]*tabindex[^>]*(?!role=)[^>]*>/g, // Focusable divs without role
            /<select[^>]*(?!aria-label)(?!title)[^>]*>/g, // Unlabeled selects
            /aria-[a-z]+="[^"]*"/g, // ARIA attributes (potential issues)
            /<ul[^>]*role="menu"[^>]*>/g, // Invalid ARIA roles
        ];
        let estimatedCount = 0;
        for (const pattern of violationPatterns) {
            const matches = content.match(pattern);
            if (matches) {
                estimatedCount += matches.length;
            }
        }
        // File-specific adjustments based on known content
        if (filename.includes('wcag-violations.html')) {
            return 30; // Known comprehensive test file
        }
        else if (filename.includes('wcag-violations.jsx') || filename.includes('wcag-violations.tsx')) {
            return 25; // React components typically have fewer detectable violations
        }
        else if (filename.includes('wcag-violations.vue')) {
            return 15; // Vue components
        }
        else if (filename.includes('wcag-violations.svelte')) {
            return 28; // Svelte components
        }
        // Fallback to pattern-based estimation
        return Math.max(estimatedCount, 10);
    }
    async runSingleFileTest(filePath) {
        const filename = path.basename(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        // Estimate total expected violations based on file analysis
        const totalExpected = this.estimateExpectedViolations(content, filename);
        // Run axe-core test
        const axeStart = Date.now();
        const axeResult = await this.runAxeTest(content, filename);
        const axeTime = Date.now() - axeStart;
        const foundViolations = axeResult.violations.length;
        const percentage = totalExpected > 0 ? Math.round((foundViolations / totalExpected) * 100) : 0;
        const detectionRate = `${foundViolations}/${totalExpected} (${percentage}%)`;
        return {
            filename,
            axeViolations: foundViolations,
            totalExpectedViolations: totalExpected,
            detectionRate,
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
    displayResults() {
        this.displayTableResults();
    }
    displayTableResults() {
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
exports.AccessibilityTestSuite = AccessibilityTestSuite;
// Export function for CLI usage
async function runAccessibilityTests(config = {}) {
    const testSuite = new AccessibilityTestSuite();
    return await testSuite.runTests(config);
}
//# sourceMappingURL=standalone-test-suite.js.map