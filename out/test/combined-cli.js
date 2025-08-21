#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_suite_1 = require("./test-suite");
async function main() {
    try {
        const suite = new test_suite_1.TestSuite();
        await suite.runCombined();
        console.log('\n✅ Combined tests (Axe + ESLint + AI) completed!');
    }
    catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=combined-cli.js.map