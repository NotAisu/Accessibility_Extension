import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');
const skillPath = path.join(root, 'skills', 'allyproof-browser-audit', 'SKILL.md');
const readmePath = path.join(root, 'README.md');

function readSkill(): string {
    return fs.readFileSync(skillPath, 'utf-8');
}

describe('Rendered browser audit Skill (#87)', () => {
    it('ships valid Agent Skills frontmatter matching its directory name', () => {
        const skill = readSkill();
        const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
        assert.ok(frontmatter.length > 0, 'SKILL.md must start with YAML frontmatter');
        const name = /^name: (.+)$/m.exec(frontmatter)?.[1];
        const description = /^description: (.+)$/m.exec(frontmatter)?.[1];
        assert.strictEqual(name, 'allyproof-browser-audit');
        assert.strictEqual(name, path.basename(path.dirname(skillPath)));
        assert.ok(description && description.length >= 20 && description.length <= 250, 'description must be concise');
    });

    it('enforces a strict two-stage workflow: static Check first, then rendered browser audit', () => {
        const skill = readSkill();
        const stage1 = skill.indexOf('## Stage 1');
        const stage2 = skill.indexOf('## Stage 2');
        assert.ok(stage1 >= 0, 'must define Stage 1');
        assert.ok(stage2 > stage1, 'Stage 2 must follow Stage 1');

        const stage1Text = skill.slice(stage1, stage2);
        assert.match(stage1Text, /\bcheck\b/i);
        assert.match(stage1Text, /a11y_check/);
        assert.match(stage1Text, /allyproof check/);
        assert.match(stage1Text, /Proven/i);
        assert.match(stage1Text, /before opening a browser/i);
        assert.match(stage1Text, /allyproof-ignore/);
    });

    it('separates deterministic browser measurements from visual AI judgment (ADR 0004)', () => {
        const skill = readSkill();
        const measurements = skill.indexOf('### Deterministic browser measurements');
        const judgment = skill.indexOf('### Visual AI judgment');
        assert.ok(measurements >= 0, 'must have a deterministic browser measurements section');
        assert.ok(judgment > measurements, 'must separate visual AI judgment from deterministic measurements');

        const measurementText = skill.slice(measurements, judgment);
        for (const criterion of ['1.4.3', '1.4.11', '2.5.8', '2.4.7', '2.4.11', '1.4.10']) {
            assert.ok(measurementText.includes(criterion), `deterministic measurements must cover ${criterion}`);
        }
        assert.match(measurementText, /24\s*[×x]\s*24/);
        assert.match(measurementText, /320\s*px/i);
        assert.match(measurementText, /Tab/);
        assert.match(measurementText, /sticky|fixed/i);
        assert.match(measurementText, /accessibility tree/i);
        assert.match(measurementText, /focus trap/i);
        assert.match(measurementText, /live region|aria-live|4\.1\.3/i);

        const judgmentText = skill.slice(judgment);
        assert.match(judgmentText, /never .*confirmed failure/i);
        assert.match(judgmentText, /needs a person|Needs Review/i);
    });

    it('documents the optional rendered browser audit Skill in README alongside the main Skill', () => {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        assert.ok(readme.includes('skills/allyproof-browser-audit/SKILL.md'), 'README must link the browser audit Skill');
        assert.ok(readme.includes('allyproof-browser-audit'), 'README must name the browser audit Skill');
    });
});
