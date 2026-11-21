// Set Up Commit Check (#79) as plain logic: which files to write so a commit that adds Findings is blocked, in the
// project's own hook manager. commit-check-command.ts shows the plan and writes it after the user confirms.

/** The project's files, by path relative to the repository root; undefined for a missing file. */
export type ReadFile = (path: string) => Promise<string | undefined>;

export interface PlannedFile {
    path: string;
    /** The current content; undefined when the file is created. */
    before: string | undefined;
    after: string;
    /** A Git hook must be executable. */
    executable?: true;
}

export interface CommitCheckPlan {
    /** Where the check runs: lefthook, Husky, lint-staged, the pre-commit framework or a plain Git hook. */
    manager: string;
    files: PlannedFile[];
}

const CHECKED_FILES = '*.{html,htm,vue,svelte,jsx,tsx,astro,ts}';
const CHECKED_PATTERN = String.raw`\.(html?|vue|svelte|jsx|tsx|astro|ts)$`;

/** The command that runs the command line, through the project's package manager. */
export async function runner(read: ReadFile): Promise<string> {
    const manifest = parse(await read('package.json'));
    const installed = [manifest?.devDependencies, manifest?.dependencies].some(deps => isRecord(deps) && 'allyproof' in deps);
    if (await read('pnpm-lock.yaml') !== undefined) return installed ? 'pnpm exec allyproof' : 'pnpm dlx allyproof';
    if (await read('yarn.lock') !== undefined) return installed ? 'yarn allyproof' : 'yarn dlx allyproof';
    return installed ? 'npx allyproof' : 'npx --yes allyproof';
}

/**
 * The files to write: an entry in lefthook, lint-staged or the pre-commit framework, a line in Husky's pre-commit
 * hook, or a plain Git hook. An existing entry is extended, never replaced; a file that already runs Allyproof stays.
 */
export async function planCommitCheck(read: ReadFile, options: { workflow: boolean; actionRef: string }): Promise<CommitCheckPlan> {
    const run = await runner(read);
    const plan = await hookPlan(read, run);
    if (options.workflow) {
        const path = '.github/workflows/allyproof.yml';
        const before = await read(path);
        if (before === undefined) plan.files.push({ path, before, after: workflow(options.actionRef) });
    }
    plan.files = plan.files.filter(file => file.before !== file.after);
    return plan;
}

async function hookPlan(read: ReadFile, run: string): Promise<CommitCheckPlan> {
    const staged = `${run} check --staged`;
    for (const path of ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml']) {
        const before = await read(path);
        if (before !== undefined) return { manager: 'lefthook', files: [{ path, before, after: withLefthookCommand(before, staged) }] };
    }
    if (await read('.husky/_/husky.sh') !== undefined || await read('.husky/pre-commit') !== undefined || await read('.husky/_/h') !== undefined) {
        const lintStaged = await lintStagedPlan(read, run);
        if (lintStaged) return { manager: 'Husky with lint-staged', files: [lintStaged] };
        const before = await read('.husky/pre-commit');
        return { manager: 'Husky', files: [{ path: '.husky/pre-commit', before, after: withLine(before ?? '', staged) }] };
    }
    const preCommit = await read('.pre-commit-config.yaml');
    if (preCommit !== undefined) {
        return { manager: 'the pre-commit framework', files: [{ path: '.pre-commit-config.yaml', before: preCommit, after: withPreCommitHook(preCommit, run) }] };
    }
    const before = await read('.git/hooks/pre-commit');
    return { manager: 'a Git hook', files: [{ path: '.git/hooks/pre-commit', before, after: withLine(before ?? '#!/bin/sh\n', staged), executable: true }] };
}

// lint-staged stashes what is not staged, so the files it passes hold the staged content
async function lintStagedPlan(read: ReadFile, run: string): Promise<PlannedFile | undefined> {
    const command = `${run} check`;
    const rc = await read('.lintstagedrc') ?? await read('.lintstagedrc.json');
    const rcPath = await read('.lintstagedrc') !== undefined ? '.lintstagedrc' : '.lintstagedrc.json';
    if (rc !== undefined) {
        const config = parse(rc);
        return config ? { path: rcPath, before: rc, after: withLintStagedEntry(rc, config, command) } : undefined;
    }
    const manifestText = await read('package.json');
    const manifest = parse(manifestText);
    const config = manifest?.['lint-staged'];
    if (!manifestText || !isRecord(config)) return undefined;
    // The manifest may name allyproof as a dependency, so only the lint-staged entry tells whether it runs
    const section = JSON.stringify(config);
    if (alreadyRuns(section)) return { path: 'package.json', before: manifestText, after: manifestText };
    const updated = { ...manifest, 'lint-staged': JSON.parse(withLintStagedEntry(section, config, command)) as unknown };
    return { path: 'package.json', before: manifestText, after: JSON.stringify(updated, null, indentOf(manifestText)) + '\n' };
}

function withLintStagedEntry(text: string, config: Record<string, unknown>, command: string): string {
    if (alreadyRuns(text)) return text;
    const existing = config[CHECKED_FILES];
    const entry = existing === undefined ? command : [...(Array.isArray(existing) ? existing as unknown[] : [existing]), command];
    return JSON.stringify({ ...config, [CHECKED_FILES]: entry }, null, indentOf(text)) + '\n';
}

export function withLefthookCommand(text: string, command: string): string {
    if (alreadyRuns(text)) return text;
    const entry = ['    allyproof:', `      glob: "${CHECKED_FILES}"`, `      run: ${command}`];
    const lines = text.replace(/\n*$/, '').split('\n');
    const hook = lines.findIndex(line => /^pre-commit:\s*$/.test(line));
    if (hook === -1) return [...lines, '', 'pre-commit:', '  commands:', ...entry, ''].join('\n');
    const end = lines.findIndex((line, i) => i > hook && /^\S/.test(line));
    const commands = lines.findIndex((line, i) => i > hook && (end === -1 || i < end) && /^ {2}commands:\s*$/.test(line));
    if (commands === -1) lines.splice(hook + 1, 0, '  commands:', ...entry);
    else lines.splice(commands + 1, 0, ...entry);
    return lines.join('\n') + '\n';
}

export function withPreCommitHook(text: string, run: string): string {
    if (alreadyRuns(text)) return text;
    const indent = /^( *)- repo:/m.exec(text)?.[1] ?? '';
    const hook = [
        `${indent}- repo: local`,
        `${indent}  hooks:`,
        `${indent}    - id: allyproof`,
        `${indent}      name: Allyproof`,
        `${indent}      entry: ${run} check`,
        `${indent}      language: system`,
        `${indent}      files: '${CHECKED_PATTERN}'`
    ];
    const body = /^repos:/m.test(text) ? text.replace(/\n*$/, '\n') : `${text.replace(/\n*$/, '\n')}repos:\n`;
    return body + hook.join('\n') + '\n';
}

function withLine(text: string, line: string): string {
    if (alreadyRuns(text)) return text;
    return text.trim() ? `${text.replace(/\n*$/, '\n')}${line}\n` : `${line}\n`;
}

function workflow(actionRef: string): string {
    return [
        'name: Accessibility',
        'on:',
        '  pull_request:',
        'permissions:',
        '  contents: read',
        '  security-events: write',
        'jobs:',
        '  allyproof:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '        with:',
        '          fetch-depth: 0',
        `      - uses: ${actionRef}`,
        ''
    ].join('\n');
}

const alreadyRuns = (text: string) => /\ballyproof\b/.test(text);
const indentOf = (text: string) => /\n( +|\t)"/.exec(text)?.[1] ?? 2;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(text: string | undefined): Record<string, unknown> | undefined {
    if (text === undefined) return undefined;
    try {
        const value = JSON.parse(text) as unknown;
        return isRecord(value) ? value : undefined;
    } catch {
        return undefined;
    }
}
