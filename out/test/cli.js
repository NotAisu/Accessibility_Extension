#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const accessibility_test_suite_1 = require("./accessibility-test-suite");
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--model':
            case '-m':
                result.model = args[++i];
                break;
            case '--format':
            case '-f':
                result.format = args[++i];
                break;
            case '--help':
            case '-h':
                result.help = true;
                break;
            default:
                if (!arg.startsWith('-') && !result.filename) {
                    result.filename = arg;
                }
                break;
        }
    }
    return result;
}
function showHelp() {
    console.log(`
🚀 WCAG 2.2 AA Accessibility Test Suite

Usage:
  npm run test [filename] [options]

Arguments:
  filename                Test a specific file (optional)
                         Available: wcag-violations.html, .jsx, .tsx, .vue, .svelte

Options:
  -m, --model <model>    GitHub Copilot model to use
                         Available: gpt-4o, gpt-4.1, claude-3.5-sonnet, 
                                   claude-3.7-sonnet, gemini-2.0-flash, etc.
  -f, --format <format>  Output format (table, json, both)
                         Default: table
  -h, --help            Show this help message

Examples:
  npm run test                                    # Test all files with default model
  npm run test wcag-violations.html              # Test specific file
  npm run test --model claude-3.5-sonnet         # Use Claude model
  npm run test --format json                     # JSON output
  npm run test wcag-violations.vue -m gpt-4o -f both

Available Models:
  • gpt-4o (default)          • claude-3.5-sonnet
  • gpt-4.1                   • claude-3.7-sonnet  
  • claude-3.7-sonnet-thinking • claude-4-sonnet
  • gemini-2.0-flash         • gemini-2.5-pro
  • o3-mini                   • o4-mini

Test Results Include:
  ✅ Axe-core violations      (automated accessibility testing)
  🤖 AI-only violations      (semantic accessibility analysis)  
  🚀 Combined violations     (comprehensive coverage)
  📊 Performance metrics     (execution times)
  📈 Improvement percentage  (AI enhancement over axe-core)
`);
}
async function main() {
    const args = parseArgs();
    if (args.help) {
        showHelp();
        return;
    }
    try {
        console.log('🔧 Configuring test environment...');
        const config = {
            githubCopilotModel: args.model || 'gpt-4o',
            testFiles: args.filename ? [args.filename] : undefined,
            outputFormat: args.format || 'table'
        };
        console.log(`🤖 Using GitHub Copilot model: ${config.githubCopilotModel}`);
        if (config.testFiles) {
            console.log(`📁 Testing specific file: ${config.testFiles[0]}`);
        }
        else {
            console.log('📁 Testing all available files');
        }
        const results = await (0, accessibility_test_suite_1.runAccessibilityTests)(config);
        // Exit with error code if any tests had issues
        const hasErrors = results.some(r => r.axeViolations === 0 && r.aiViolations === 0 && r.combinedViolations === 0);
        if (hasErrors) {
            process.exit(1);
        }
    }
    catch (error) {
        console.error('❌ Test execution failed:', error);
        process.exit(1);
    }
}
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
if (require.main === module) {
    main();
}
//# sourceMappingURL=cli.js.map