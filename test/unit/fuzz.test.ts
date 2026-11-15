import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { analyse } from '../../src/core/analysis';
import type { GroundTruthSet } from '../ground-truth/ground-truth';

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
    for (const set of ['act', 'own']) {
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
            const next = random(languageId.length);
            for (const [index, text] of fuzzedInputs(samples, next).entries()) {
                const result = await analyse({ languageId, text }).catch((error: Error) =>
                    assert.fail(`input ${index} (${JSON.stringify(text.slice(0, 80))}…): ${error.message}`));
                assert.ok(Array.isArray(result.findings) && Array.isArray(result.needsReview), `input ${index}`);
            }
        });
    }
});
