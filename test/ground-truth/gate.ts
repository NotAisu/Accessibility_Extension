/**
 * Runs the Check over every ground-truth set and fails when precision or recall of any
 * WCAG criterion drops below the stored baseline.
 *   npm run test:gate                 compare with baseline.json
 *   npm run test:gate -- --update     store the current scores as the new baseline
 */
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import { GroundTruthSet, Tally, addTallies, precision, recall, scoreCase } from './ground-truth';

const SETS = ['act', 'own'];
const BASELINE = path.join(__dirname, 'baseline.json');

type Scores = Record<string, { precision: number | null; recall: number | null } & Tally>;

async function measure(): Promise<Scores> {
    const totals = new Map<string, Tally>();
    for (const name of SETS) {
        const dir = path.join(__dirname, name);
        const set: GroundTruthSet = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf-8'));
        for (const testCase of set.cases) {
            const text = fs.readFileSync(path.join(dir, testCase.file), 'utf-8');
            const { findings } = await analyse({ languageId: testCase.languageId, text });
            const reported = findings.map(f => ({ line: lineAt(text, f.range.start), criteria: f.criteria }));
            addTallies(totals, scoreCase(testCase.expect, reported));
        }
    }
    const scores: Scores = {};
    for (const criterion of [...totals.keys()].sort(byCriterion)) {
        const t = totals.get(criterion)!;
        scores[criterion] = { precision: round(precision(t)), recall: round(recall(t)), ...t };
    }
    return scores;
}

function lineAt(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
    return line;
}

function round(value: number | null): number | null {
    return value === null ? null : Math.round(value * 1000) / 1000;
}

function byCriterion(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

function format(value: number | null): string {
    return value === null ? '   –' : value.toFixed(2);
}

function regressions(scores: Scores, baseline: Scores): string[] {
    const problems: string[] = [];
    for (const [criterion, base] of Object.entries(baseline)) {
        const now = scores[criterion];
        if (!now) {
            problems.push(`${criterion}: no longer measured`);
            continue;
        }
        for (const metric of ['precision', 'recall'] as const) {
            const was = base[metric];
            const is = now[metric];
            // Without a baseline value (nothing reported yet), any false positive is a regression
            const dropped = was === null ? metric === 'precision' && is !== null && is < 1 : is === null || is < was;
            if (dropped) {
                problems.push(`${criterion}: ${metric} ${format(is)} < baseline ${format(was)}`);
            }
        }
    }
    return problems;
}

async function main() {
    const scores = await measure();
    console.log('criterion  precision  recall    tp   fp   fn');
    for (const [criterion, s] of Object.entries(scores)) {
        console.log(`${criterion.padEnd(9)}  ${format(s.precision).padStart(9)}  ${format(s.recall).padStart(6)}  ${String(s.tp).padStart(4)} ${String(s.fp).padStart(4)} ${String(s.fn).padStart(4)}`);
    }

    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASELINE, JSON.stringify(scores, null, 2) + '\n');
        console.log(`\nBaseline written to ${path.relative(process.cwd(), BASELINE)}`);
        return;
    }
    const baseline: Scores = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
    const problems = regressions(scores, baseline);
    if (problems.length > 0) {
        console.error(`\nCheck quality dropped below the baseline:\n  ${problems.join('\n  ')}`);
        process.exit(1);
    }
    console.log('\nNo criterion below the baseline.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
