import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GroundTruthSet } from '../ground-truth/ground-truth';
import { FieldSource, Labels, labelField } from '../ground-truth/label-field';

const COMMIT = 'a'.repeat(40);
const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n';
const PAGE = '<!doctype html>\n<html lang="en">\n<head><title>Shop</title></head>\n<body>\n<img src="logo.png">\n<img src="cart.png" alt="Cart">\n</body>\n</html>\n';
const IMG_FAILS: Labels = { criteria: [{ criterion: '1.1.1', verdict: 'fails', lines: [5], reason: 'img without alt, F65' }] };
const IMG_PASSES: Labels = { criteria: [{ criterion: '1.1.1', verdict: 'passes', reason: 'decorative' }] };

describe('field labelling with two labellers', () => {
    let root: string;
    let fieldDir: string;
    let workDir: string;
    let evidenceDir: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'label-field-'));
        fieldDir = path.join(root, 'field');
        workDir = path.join(root, 'work');
        evidenceDir = path.join(root, 'act');
        for (const dir of [fieldDir, evidenceDir]) {
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'expectations.json'), JSON.stringify({ source: 'test', cases: [] }, null, 2) + '\n');
        }
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const shop: FieldSource = { repo: 'acme/shop', commit: COMMIT, file: 'src/index.html' };
    const files: Record<string, string> = {
        [`https://raw.githubusercontent.com/acme/shop/${COMMIT}/src/index.html`]: PAGE,
        [`https://raw.githubusercontent.com/acme/shop/${COMMIT}/LICENSE`]: MIT
    };
    const fetchText = (served: Record<string, string>) => (url: string) => Promise.resolve(served[url]);
    const run = (labeller?: (dir: string, prompt: string) => string, sources = [shop], served = files) =>
        labelField({ sources, fieldDir, workDir, evidenceDirs: [evidenceDir, fieldDir], fetchText: fetchText(served), labeller });
    const field = () => JSON.parse(fs.readFileSync(path.join(fieldDir, 'expectations.json'), 'utf-8')) as GroundTruthSet;

    it('writes the labels both labellers agree on, with the file, its source and its licence', async () => {
        const report = await run(() => JSON.stringify(IMG_FAILS));

        assert.deepStrictEqual(report.written, ['acme_shop/src/index.html']);
        const [testCase] = field().cases;
        assert.deepStrictEqual(testCase.expect, [{ criterion: '1.1.1', line: 5 }]);
        assert.strictEqual(testCase.languageId, 'html');
        assert.match(testCase.note!, new RegExp(`https://github.com/acme/shop/blob/${COMMIT}/src/index.html \\(licence in acme_shop/LICENSE, MIT\\)`));
        assert.strictEqual(fs.readFileSync(path.join(fieldDir, 'acme_shop/src/index.html'), 'utf-8'), PAGE);
        assert.strictEqual(fs.readFileSync(path.join(fieldDir, 'acme_shop/LICENSE'), 'utf-8'), MIT);
    });

    it('never gives the second labeller the first labels', async () => {
        const seen: { dir: string; prompt: string; files: string }[] = [];
        await run((dir, prompt) => {
            seen.push({ dir, prompt, files: fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n') });
            return JSON.stringify(seen.length === 1 ? { criteria: [{ ...IMG_FAILS.criteria[0], reason: 'FIRST-LABELLER-MARK' }] } : IMG_FAILS);
        });

        assert.strictEqual(seen.length, 2);
        const [first, second] = seen;
        assert.notStrictEqual(first.dir, second.dir);
        assert.strictEqual(first.prompt, second.prompt);
        assert.match(second.prompt, /line 5: .*\(1\.1\.1/);
        assert.doesNotMatch(second.prompt + second.files, /FIRST-LABELLER-MARK/);
    });

    it('reports a disagreement and leaves the case unlabelled', async () => {
        let call = 0;
        const report = await run(() => JSON.stringify(call++ === 0 ? IMG_FAILS : IMG_PASSES));

        assert.deepStrictEqual(report.written, []);
        assert.match(report.disagreements.join('\n'), /1\.1\.1 fails \/ passes/);
        assert.deepStrictEqual(field().cases, []);
    });

    it('leaves a close call unlabelled and keeps the agreed labels', async () => {
        let call = 0;
        const report = await run(() => JSON.stringify({
            criteria: [...IMG_FAILS.criteria, { criterion: '1.4.3', verdict: call++ === 0 ? 'unsure' : 'passes', reason: 'contrast from a theme' }]
        }));

        assert.deepStrictEqual(field().cases[0].expect, [{ criterion: '1.1.1', line: 5 }]);
        assert.match(report.closeCalls.join('\n'), /1\.4\.3 unsure/);
    });

    it('rejects a file whose text repeats an evidence case', async () => {
        fs.writeFileSync(path.join(evidenceDir, 'page.html'), PAGE);
        fs.writeFileSync(path.join(evidenceDir, 'expectations.json'), JSON.stringify({ source: 'test', cases: [{ file: 'page.html', languageId: 'html', expect: [] }] }));

        const report = await run(() => JSON.stringify(IMG_FAILS));

        assert.match(report.rejected.join('\n'), /same text as act\/page\.html/);
        assert.deepStrictEqual(field().cases, []);
    });

    it('rejects a project without a permissive licence', async () => {
        const served = { ...files, [`https://raw.githubusercontent.com/acme/shop/${COMMIT}/LICENSE`]: 'GNU GENERAL PUBLIC LICENSE Version 3' };

        const report = await run(() => JSON.stringify(IMG_FAILS), [shop], served);

        assert.match(report.rejected.join('\n'), /not a permissive/);
    });

    it('waits for labels written by labellers run outside the command, then merges them', async () => {
        const waiting = await run();
        assert.strictEqual(waiting.waiting.length, 2);
        for (const prompt of waiting.waiting) fs.writeFileSync(path.join(path.dirname(prompt), 'labels.json'), JSON.stringify(IMG_FAILS));

        const report = await run();

        assert.deepStrictEqual(report.written, ['acme_shop/src/index.html']);
        assert.deepStrictEqual(report.waiting, []);
    });
});
