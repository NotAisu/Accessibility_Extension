#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';
import { TestSuite } from '../test-suite';

async function main() {
    const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');
    const expectedDir = path.join(process.cwd(), 'test', 'expected');
    if (!fs.existsSync(expectedDir)) fs.mkdirSync(expectedDir, { recursive: true });

    const suite = new TestSuite();
    const files = fs.readdirSync(fixturesDir).filter(f => fs.statSync(path.join(fixturesDir, f)).isFile());
    console.log(`Found ${files.length} fixtures`);

    for (const file of files) {
        try {
            console.log(`Processing: ${file}`);
            // run aiTest for default strategy & first model (TestSuite handles model env)
            const strategyName = process.env.AI_STRATEGY || 'direct-instruction';
            const modelsEnv = process.env.AI_MODELS || process.env.OPENROUTER_DEFAULT_MODEL || '';
            const model = modelsEnv.split(',').map(s=>s.trim()).find(Boolean) || '';
            const content = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
            // aiTest is declared private in TestSuite; access dynamically at runtime
            const aiTestFn = (suite as any)['aiTest'];
            if (typeof aiTestFn !== 'function') throw new Error('aiTest function not accessible on TestSuite instance');
            const aiResult = await aiTestFn.call(suite, content, strategyName, model);

            const entries = (aiResult.violations || []).map((v: any) => ({ line: v.line, ruleId: v.ruleId || '', element: v.element || '', issue: v.issue || '', recommendation: v.recommendation || '' }));
            const outPath = path.join(expectedDir, `${file}.json`);
            fs.writeFileSync(outPath, JSON.stringify(entries, null, 2), 'utf-8');
            console.log(`Wrote ${outPath} (${entries.length} entries)`);
        } catch (e) {
            console.error(`Failed ${file}:`, e);
        }
    }
    console.log('Done. Review files under test/expected and commit them.');
}

main().catch(e=>{ console.error(e); process.exit(1); });
