// Measures the Check on one typical file in a fresh process, so the first run also loads its engine:
// prints the first run and the warm runs after it, in ms, as JSON
import '../../esm-only-packages';
import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { analyse } from '../../../src/core/analysis';

const [file, languageId, runs] = process.argv.slice(2);
const document = { languageId, text: fs.readFileSync(file, 'utf-8') };

async function main() {
    const timed = async () => {
        const start = performance.now();
        await analyse(document);
        return performance.now() - start;
    };
    const firstLoad = await timed();
    const warm: number[] = [];
    for (let i = 0; i < Number(runs); i++) warm.push(await timed());
    process.stdout.write(JSON.stringify({ firstLoad, warm }));
}

void main();
