#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const standalone_test_suite_1 = require("./standalone-test-suite");
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
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
  filename              Test specific file (optional)

Options:
  -h, --help           Show this help message

Examples:
  npm run test                           # Run all tests
  npm run test wcag-violations.html     # Test specific file
  npm run test --format json            # JSON output
  npm run test --format both            # Table and JSON output

Test Files:
  - wcag-violations.html    (HTML violations)
  - wcag-violations.jsx     (React JSX violations)
  - wcag-violations.tsx     (React TypeScript violations)  
  - wcag-violations.vue     (Vue component violations)
  - wcag-violations.svelte  (Svelte component violations)
`);
}
async function main() {
    const args = parseArgs();
    if (args.help) {
        showHelp();
        return;
    }
    try {
        const config = {
            testFiles: args.filename ? [args.filename] : undefined
        };
        await (0, standalone_test_suite_1.runAccessibilityTests)(config);
        console.log('\n✅ Test suite completed successfully');
    }
    catch (error) {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=standalone-cli.js.map