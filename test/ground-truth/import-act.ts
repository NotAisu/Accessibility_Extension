/**
 * Regenerates test/ground-truth/act from a clone of act-rules/act-rules.github.io:
 *   git clone https://github.com/act-rules/act-rules.github.io.git <dir>
 *   git -C <dir> checkout <commit>
 *   npx ts-node test/ground-truth/import-act.ts <dir>
 *
 * Only static examples are kept: a single HTML code block without scripts, media,
 * frames, embedded objects or CSS, because the Check analyses source and has no layout.
 * Text contrast keeps inline styles: static contrast decides it from literal colors.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isTargetCriterion } from '../../src/core/wcag';
import type { GroundTruthSet } from './ground-truth';

const NOT_STATIC = /<script|<video|<audio|<track|<object|<embed|<iframe|<frame|<canvas|<link|<style|\sstyle=|<math/i;
const NOT_STATIC_KEEPING_INLINE_STYLES = /<script|<video|<audio|<track|<object|<embed|<iframe|<frame|<canvas|<link|<style|<math/i;
// Rules whose examples keep inline styles: "Text has minimum contrast"
const INLINE_STYLE_RULES = new Set(['afw4f7']);

const outcomes = { Passed: 'passed', Failed: 'failed', Inapplicable: 'inapplicable' } as const;

function main(clone: string) {
    const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const outDir = path.join(__dirname, 'act');
    const casesDir = path.join(outDir, 'cases');
    fs.rmSync(casesDir, { recursive: true, force: true });
    fs.mkdirSync(casesDir, { recursive: true });

    const set: GroundTruthSet = {
        source: `https://github.com/act-rules/act-rules.github.io/tree/${commit}`,
        cases: []
    };
    const rulesDir = path.join(clone, '_rules');
    for (const file of fs.readdirSync(rulesDir).filter(f => f.endsWith('.md')).sort()) {
        const markdown = fs.readFileSync(path.join(rulesDir, file), 'utf-8');
        const frontMatter = markdown.split(/^---$/m)[1] ?? '';
        if (/^deprecated:/m.test(frontMatter)) continue;
        const id = /^id: (\S+)/m.exec(frontMatter)?.[1];
        const name = /^name: (.+)$/m.exec(frontMatter)?.[1].trim();
        const criteria = conformanceCriteria(frontMatter);
        if (!id || !name || criteria.length === 0) continue;

        for (const example of examples(markdown)) {
            // A page outside the language-match rule can still lack a language declaration.
            if (id === 'ucwvc8' && example.outcome === 'inapplicable') continue;
            if ((INLINE_STYLE_RULES.has(id) ? NOT_STATIC_KEEPING_INLINE_STYLES : NOT_STATIC).test(example.code)) continue;
            const caseFile = `${id}-${example.outcome}-${example.number}.html`;
            const title = `${name} ${example.outcome} example ${example.number}`;
            fs.writeFileSync(path.join(casesDir, caseFile), asDocument(example.code, title));
            set.cases.push({
                file: `cases/${caseFile}`,
                languageId: 'html',
                note: `ACT rule ${id} "${name}", ${example.outcome} example ${example.number}`,
                expect: criteria.map(criterion => ({
                    criterion,
                    present: example.outcome === 'failed'
                }))
            });
        }
    }
    fs.writeFileSync(path.join(outDir, 'expectations.json'), JSON.stringify(set, null, 2) + '\n');
    console.log(`Imported ${set.cases.length} cases from ${commit}`);
}

// Criteria under accessibility_requirements that count for conformance, limited to WCAG 2.2 A/AA
function conformanceCriteria(frontMatter: string): string[] {
    const criteria: string[] = [];
    const pattern = /^ {2}wcag2\d:(\d+\.\d+\.\d+):[^\n]*\n((?: {4}[^\n]*\n)*)/gm;
    for (const [, criterion, body] of frontMatter.matchAll(pattern)) {
        if (/forConformance: true/.test(body) && isTargetCriterion(criterion) && !criteria.includes(criterion)) {
            criteria.push(criterion);
        }
    }
    return criteria;
}

function* examples(markdown: string) {
    const pattern = /^#### (Passed|Failed|Inapplicable) Example (\d+)\n([\s\S]*?)(?=^#{2,4} |(?![\s\S]))/gm;
    for (const [, outcome, number, body] of markdown.matchAll(pattern)) {
        const blocks = [...body.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)];
        if (blocks.length !== 1 || blocks[0][1] !== 'html') continue;
        yield { outcome: outcomes[outcome as keyof typeof outcomes], number: Number(number), code: blocks[0][2] };
    }
}

// Fragments are wrapped in a minimal valid page so page-level rules do not fire on the wrapper
function asDocument(code: string, title: string): string {
    if (/^\s*(<!doctype|<html)/i.test(code)) return code;
    return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<title>${title}</title>\n</head>\n<body>\n${code}</body>\n</html>\n`;
}

main(process.argv[2] ?? (() => { throw new Error('usage: import-act.ts <act-rules clone>'); })());
