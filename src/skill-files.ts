/** Skills folders the Skill can be added to; agents read Skills from these in a repository. */
export const SKILL_TARGETS = ['.github/skills', '.claude/skills', '.agents/skills'] as const;
export type SkillTarget = typeof SKILL_TARGETS[number];
/** Read by GitHub Copilot, including Copilot code review on pull requests. */
export const DEFAULT_SKILL_TARGET: SkillTarget = '.github/skills';

/** The repository's files, by workspace-relative path with `/` separators. */
export interface SkillFiles {
    /** The file's text, or undefined when it does not exist. */
    read(path: string): Promise<string | undefined>;
    /** Writes the file, creating its folders. */
    write(path: string, text: string): Promise<void>;
}

/** A Skill file that exists with other text than the one to write. */
export interface ExistingSkill {
    path: string;
    /** The version it carries; undefined when it carries none. */
    version: string | undefined;
}

/** Whether to replace the existing Skill files: true replaces, false keeps them, undefined writes nothing. */
export type ConfirmReplace = (existing: ExistingSkill[]) => Promise<boolean | undefined>;

export interface AddedSkill {
    written: string[];
    /** Already held exactly this Skill. */
    unchanged: string[];
    /** Held another text, kept because replacing them was declined. */
    kept: string[];
}

export function skillPath(target: SkillTarget): string {
    return `${target}/allyproof/SKILL.md`;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const VERSION = /^metadata:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+version:[ \t]*"?([^"\r\n]+?)"?[ \t]*$/m;

/** The Skill as written to a repository: the shipped Skill with `version` in its frontmatter `metadata`. */
export function versionedSkill(skill: string, version: string): string {
    const frontmatter = FRONTMATTER.exec(skill);
    if (!frontmatter) throw new Error('The Skill has no frontmatter');
    if (/^metadata:/m.test(frontmatter[1])) throw new Error('The shipped Skill already has metadata');
    const end = skill.indexOf(frontmatter[1]) + frontmatter[1].length;
    return `${skill.slice(0, end)}\nmetadata:\n  version: "${version}"${skill.slice(end)}`;
}

/** The version a written Skill carries, if any. */
export function skillVersion(text: string): string | undefined {
    const frontmatter = FRONTMATTER.exec(text);
    return frontmatter ? VERSION.exec(`${frontmatter[1]}\n`)?.[1] : undefined;
}

/**
 * Writes `skill` to every target. A file that holds other text is only replaced once `confirmReplace` agrees;
 * when it is dismissed, nothing is written and undefined comes back.
 */
export async function addSkill(targets: readonly SkillTarget[], skill: string, files: SkillFiles, confirmReplace: ConfirmReplace): Promise<AddedSkill | undefined> {
    const added: AddedSkill = { written: [], unchanged: [], kept: [] };
    const fresh: string[] = [];
    const existing: ExistingSkill[] = [];
    for (const path of new Set(targets.map(skillPath))) {
        const current = await files.read(path);
        if (current === undefined) fresh.push(path);
        else if (current === skill) added.unchanged.push(path);
        else existing.push({ path, version: skillVersion(current) });
    }
    const replace = existing.length > 0 ? await confirmReplace(existing) : false;
    if (replace === undefined) return undefined;
    const paths = existing.map(e => e.path);
    if (replace) fresh.push(...paths);
    else added.kept.push(...paths);
    for (const path of fresh) {
        await files.write(path, skill);
        added.written.push(path);
    }
    return added;
}
