import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { addSkill, ConfirmReplace, ExistingSkill, SkillFiles, skillVersion, versionedSkill } from '../../src/skill-files';

const shipped = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'allyproof', 'SKILL.md'), 'utf-8');
const skill = versionedSkill(shipped, '0.3.0');

function repository(initial: Record<string, string> = {}): SkillFiles & { files: Map<string, string> } {
    const files = new Map(Object.entries(initial));
    return {
        files,
        read: path => Promise.resolve(files.get(path)),
        write: (path, text) => {
            files.set(path, text);
            return Promise.resolve();
        }
    };
}

function answering(answer: boolean | undefined): ConfirmReplace & { asked: ExistingSkill[][] } {
    const asked: ExistingSkill[][] = [];
    return Object.assign((existing: ExistingSkill[]) => {
        asked.push(existing);
        return Promise.resolve(answer);
    }, { asked });
}

describe('Add Skill to Repository', () => {
    it('writes the Skill to each chosen skills folder', async () => {
        const repo = repository();
        const added = await addSkill(['.github/skills', '.claude/skills'], skill, repo, answering(true));

        assert.deepStrictEqual([...repo.files.keys()], ['.github/skills/allyproof/SKILL.md', '.claude/skills/allyproof/SKILL.md']);
        for (const text of repo.files.values()) assert.strictEqual(text, skill);
        assert.deepStrictEqual(added, { written: ['.github/skills/allyproof/SKILL.md', '.claude/skills/allyproof/SKILL.md'], unchanged: [], kept: [] });
    });

    it('writes the Skill to .agents/skills too', async () => {
        const repo = repository();
        await addSkill(['.agents/skills'], skill, repo, answering(true));
        assert.deepStrictEqual([...repo.files.keys()], ['.agents/skills/allyproof/SKILL.md']);
    });

    it('never replaces an existing Skill file without confirmation', async () => {
        const edited = '---\nname: allyproof\ndescription: our own\n---\n\nTeam rules.\n';
        const repo = repository({ '.github/skills/allyproof/SKILL.md': edited });
        const confirm = answering(false);
        const added = await addSkill(['.github/skills', '.claude/skills'], skill, repo, confirm);

        assert.deepStrictEqual(confirm.asked, [[{ path: '.github/skills/allyproof/SKILL.md', version: undefined }]]);
        assert.strictEqual(repo.files.get('.github/skills/allyproof/SKILL.md'), edited);
        assert.strictEqual(repo.files.get('.claude/skills/allyproof/SKILL.md'), skill);
        assert.deepStrictEqual(added?.kept, ['.github/skills/allyproof/SKILL.md']);
    });

    it('writes nothing when the confirmation is dismissed', async () => {
        const older = versionedSkill(shipped, '0.1.0');
        const repo = repository({ '.github/skills/allyproof/SKILL.md': older });
        const confirm = answering(undefined);
        const added = await addSkill(['.github/skills', '.claude/skills'], skill, repo, confirm);

        assert.strictEqual(added, undefined);
        assert.deepStrictEqual(confirm.asked, [[{ path: '.github/skills/allyproof/SKILL.md', version: '0.1.0' }]]);
        assert.deepStrictEqual([...repo.files], [['.github/skills/allyproof/SKILL.md', older]]);
    });

    it('replaces an existing Skill file once confirmed', async () => {
        const repo = repository({ '.github/skills/allyproof/SKILL.md': versionedSkill(shipped, '0.1.0') });
        const added = await addSkill(['.github/skills'], skill, repo, answering(true));

        assert.strictEqual(repo.files.get('.github/skills/allyproof/SKILL.md'), skill);
        assert.deepStrictEqual(added?.written, ['.github/skills/allyproof/SKILL.md']);
    });

    it('asks nothing when the file already holds this Skill', async () => {
        const repo = repository({ '.github/skills/allyproof/SKILL.md': skill });
        const confirm = answering(true);
        const added = await addSkill(['.github/skills'], skill, repo, confirm);

        assert.deepStrictEqual(confirm.asked, []);
        assert.deepStrictEqual(added, { written: [], unchanged: ['.github/skills/allyproof/SKILL.md'], kept: [] });
    });

    it('writes the Skill carrying its version, and otherwise exactly the shipped Skill', () => {
        assert.strictEqual(skillVersion(skill), '0.3.0');
        assert.strictEqual(skillVersion(shipped), undefined);
        assert.strictEqual(skill.replace('metadata:\n  version: "0.3.0"\n', ''), shipped);
        assert.match(skill, /^---\nname: allyproof\ndescription: .+\nmetadata:\n {2}version: "0\.3\.0"\n---\n/);
    });

    it('ships a Skill that verifies Needs Review criteria in a browser when the agent can', () => {
        const section = /^## Verify Needs Review criteria in a browser\n\n(.+)$/m.exec(shipped)?.[1] ?? '';
        assert.match(section, /If you can open the rendered page/);
        for (const criterion of ['1.4.3', '2.5.8']) assert.ok(section.includes(criterion), criterion);
        assert.match(section, /Without a browser, leave these criteria/);
    });
});
