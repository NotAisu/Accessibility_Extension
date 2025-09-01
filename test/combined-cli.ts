#!/usr/bin/env node
import { TestSuite } from './test-suite';

async function main() {
    try {
        const suite = new TestSuite();
        await suite.runCombined();
        console.log('\n✅ Combined tests (Axe + AI) completed!');
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
