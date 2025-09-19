#!/usr/bin/env ts-node
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const test_suite_1 = require("../test-suite");
async function main() {
    const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');
    const expectedDir = path.join(process.cwd(), 'test', 'expected');
    if (!fs.existsSync(expectedDir))
        fs.mkdirSync(expectedDir, { recursive: true });
    const suite = new test_suite_1.TestSuite();
    const files = fs.readdirSync(fixturesDir).filter(f => fs.statSync(path.join(fixturesDir, f)).isFile());
    console.log(`Found ${files.length} fixtures`);
    for (const file of files) {
        try {
            console.log(`Processing: ${file}`);
            // run aiTest for default strategy & first model (TestSuite handles model env)
            const strategyName = process.env.AI_STRATEGY || 'direct-instruction';
            const modelsEnv = process.env.AI_MODELS || process.env.OPENROUTER_DEFAULT_MODEL || '';
            const model = modelsEnv.split(',').map(s => s.trim()).find(Boolean) || '';
            const content = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
            // aiTest is declared private in TestSuite; access dynamically at runtime
            const aiTestFn = suite['aiTest'];
            if (typeof aiTestFn !== 'function')
                throw new Error('aiTest function not accessible on TestSuite instance');
            const aiResult = await aiTestFn.call(suite, content, strategyName, model);
            const entries = (aiResult.violations || []).map((v) => ({ line: v.line, ruleId: v.ruleId || '', element: v.element || '', issue: v.issue || '', recommendation: v.recommendation || '' }));
            const outPath = path.join(expectedDir, `${file}.json`);
            fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), 'utf-8');
            console.log(`Wrote ${outPath} (${entries.length} entries)`);
        }
        catch (e) {
            console.error(`Failed ${file}:`, e);
        }
    }
    console.log('Done. Review files under test/expected and commit them.');
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=generate-expected.js.map