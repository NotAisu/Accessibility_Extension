import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyse, ParseError } from '../../src/core/analysis';
import type { GroundTruthSet } from '../ground-truth/ground-truth';
import { analyse as analyseEveryRule } from './every-rule';

const GROUND_TRUTH = path.join(__dirname, '..', 'ground-truth');
const INPUTS_PER_LANGUAGE = 20;

// Seeded, so a crashing input can be reproduced from the test name
function random(seed: number): () => number {
    return () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed / 2 ** 31;
    };
}

// Ground-truth files per language; a new language gets fuzzed as soon as it has ground truth
function samplesByLanguage(): Map<string, string[]> {
    const samples = new Map<string, string[]>();
    for (const set of ['act', 'jsx-a11y', 'own', 'svelte', 'angular-eslint']) {
        const dir = path.join(GROUND_TRUTH, set);
        const { cases } = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf-8')) as GroundTruthSet;
        for (const testCase of cases) {
            if (!samples.has(testCase.languageId)) samples.set(testCase.languageId, []);
            samples.get(testCase.languageId)!.push(fs.readFileSync(path.join(dir, testCase.file), 'utf-8'));
        }
    }
    return samples;
}

function fuzzedInputs(samples: string[], next: () => number): string[] {
    const pick = () => samples[Math.floor(next() * samples.length)];
    const noise = (length: number) => Array.from({ length }, () => String.fromCharCode(Math.floor(next() * 0x3000))).join('');
    const inputs = [''];
    while (inputs.length < INPUTS_PER_LANGUAGE) {
        const sample = pick();
        const cut = Math.floor(next() * sample.length);
        inputs.push(
            sample.slice(0, cut),
            sample.slice(0, cut) + noise(20) + sample.slice(cut),
            noise(200)
        );
    }
    return inputs;
}

describe('analyse never crashes on random and truncated input', () => {
    for (const [languageId, samples] of samplesByLanguage()) {
        it(languageId, async function () {
            this.timeout(60000);
            const next = random([...languageId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 2 ** 31, 0));
            for (const [index, text] of fuzzedInputs(samples, next).entries()) {
                const result = await analyse({ languageId, text }).catch((error: Error) => {
                    // Unparseable input is a known outcome, any other error a crash
                    if (error instanceof ParseError) return undefined;
                    assert.fail(`input ${index} (${JSON.stringify(text.slice(0, 80))}…): ${error.message}`);
                });
                if (result) assert.ok(Array.isArray(result.findings) && Array.isArray(result.needsReview), `input ${index}`);
            }
        });
    }
});

// Equivalent code keeps its results: every rule's matches, by rule and line
describe('analyse judges markup, not formatting or names (metamorphic, field and injection sets)', () => {
    const SAMPLE_EVERY = 5;
    const cases = ['field', 'injection'].flatMap(set => {
        const dir = path.join(GROUND_TRUTH, set);
        const { cases } = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf-8')) as GroundTruthSet;
        return cases.filter((_, i) => i % SAMPLE_EVERY === 0).map(testCase => ({ ...testCase, text: fs.readFileSync(path.join(dir, testCase.file), 'utf-8') }));
    });
    const matches = async (languageId: string, text: string) => {
        const { findings, needsReview } = await analyseEveryRule({ languageId, text });
        const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;
        return [...new Set([...findings, ...needsReview.filter(e => e.ruleId)].map(m => `${m.ruleId} @${lineAt(m.range!.start)}`))].sort();
    };
    const transforms: [string, (text: string) => string][] = [
        // Astro's frontmatter fence must start its line
        ['indented', text => text.split('\n').map(line => line.trim() === '---' || !line ? line : `  ${line}`).join('\n')],
        // The static attributes of a one-line start tag, in reverse order
        ['attributes reordered', text => text.replace(/<([a-z][\w-]*)((?:[ \t]+[\w:.-]+="[^"{}\n]*")+)([ \t]*\/?>)/g,
            (_, tag: string, attributes: string, close: string) => `<${tag} ${attributes.trim().split(/(?<=")[ \t]+/).reverse().join(' ')}${close}`)],
        // Every static id and every static reference to one, in the attributes that hold id references
        ['ids renamed', text => text.replace(/(\s(?:id|for|headers|aria-labelledby|aria-describedby|aria-controls|aria-owns|aria-activedescendant|list)=")([^"{}$]*)"/g,
            (_, attribute: string, ids: string) => `${attribute}${ids.split(' ').map(id => id && `renamed-${id}`).join(' ')}"`)]
    ];
    for (const [name, transform] of transforms) {
        it(name, async function () {
            this.timeout(300000);
            for (const { file, languageId, text } of cases) {
                const original = await matches(languageId, text).catch(() => undefined);
                if (!original) continue;
                assert.deepStrictEqual(await matches(languageId, transform(text)), original, file);
            }
        });
    }
});
