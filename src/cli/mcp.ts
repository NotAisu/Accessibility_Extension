import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { documentedRules, ruleDoc } from '../core/rule-docs';
import { workspaceLanguageId } from '../workspace-check';
import SKILL from '../../skills/allyproof/SKILL.md';
import { checkAll, diskSource, LANGUAGES, posix, settingsOf, SEVERITY_RANK, treeFiles, type Source } from './check';
import type { CheckOutput } from './output';
import { explanation, ruleList } from './rules';
import { ConfigError } from './settings';

// `allyproof mcp` (#46): the Check as MCP tools over stdio, the third front end on the analysis core. It returns the
// command line's JSON result, reads only files inside the client's MCP roots (#97), writes nothing and makes no network
// requests; the checked files and the settings are data, never executed (ADR 0002). Each root is a project as the
// editor sees a workspace folder: its .vscode/settings.json applies and results name files relative to it. Rule docs and
// the rule list are those of `allyproof explain` and `allyproof rules`, and the prompt is the Skill the AI Review uses (#22).

/** A request the tool refuses, reported to the agent as a tool error. */
class Refused extends Error {}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** How many files a folder's result lists by default; the summary always covers every file. */
const DEFAULT_LIMIT = 20;

const CHECK_DESCRIPTION = 'Runs Allyproof\'s deterministic WCAG 2.2 AA Check and returns the JSON result of `allyproof check --format json` '
    + '(schema version 1): Findings of Proven rules with line, WCAG criteria, rule, message, help URL and exact `fix` edits where there are any, '
    + 'and the Needs Review entries the Check cannot decide from source. Pass `paths` to check files or folders of the project, or `code` with `path` '
    + '(or `languageId`) to check proposed code before writing it. The project\'s .vscode/settings.json rule settings, Component Mapping and '
    + 'ignore comments apply. A file that cannot be checked (parse error, engine failure) is a tool error, never an empty result. '
    + 'For folders the summary counts Findings per file, rule and criterion over every file, while `files` lists only the first files up to '
    + '`limit`; `truncated` says whether files were left out and `hint` how to narrow down.';

/**
 * Serves the MCP server on stdin and stdout until the client disconnects. Paths resolve inside the roots the client
 * sends, or inside `fallback` (the project the command line would check) when it sends none.
 */
export async function serve(fallback: string, version: string): Promise<number> {
    const server = new McpServer({ name: 'allyproof', version });
    let roots: Promise<string[]> | undefined;
    server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => { roots = undefined; });
    const currentRoots = () => {
        const asked = roots ??= rootsOf(server, fallback);
        asked.catch(() => { if (roots === asked) roots = undefined; });
        return asked;
    };
    server.registerTool('check', {
        title: 'Allyproof Check',
        description: CHECK_DESCRIPTION,
        inputSchema: {
            paths: z.array(z.string()).optional().describe('Files or folders to check, relative to the project or absolute inside it.'),
            code: z.string().optional().describe('Proposed code to check instead of a file\'s text.'),
            path: z.string().optional().describe('The file the code is for; its extension gives the language and the result names it.'),
            languageId: z.enum(LANGUAGES).optional().describe('The language of code, for example html, vue or typescriptreact. Defaults to the language of path.'),
            limit: z.number().int().positive().optional().describe(`How many files a folder's result lists, ${DEFAULT_LIMIT} by default; the summary covers every file.`)
        },
        annotations: READ_ONLY
    }, async input => {
        try {
            const { root, sources, folder } = sourcesOf(await currentRoots(), input);
            const checked = await checkAll(sources, settingsIn(root), undefined, SEVERITY_RANK.warning);
            const output = folder ? limited(checked, input.limit ?? DEFAULT_LIMIT) : checked;
            const json = { type: 'text' as const, text: JSON.stringify(output, null, 2) };
            const failed = checked.files.filter(file => file.status === 'failed');
            if (failed.length === 0) return { content: [json] };
            // A paused Check is unknown, not clean: the agent must never read it as "no Findings"
            const reasons = failed.map(file => `${file.file} could not be checked: ${file.error}`).join('\n');
            return { isError: true, content: [{ type: 'text', text: reasons }, json] };
        } catch (error) {
            if (!(error instanceof Refused || error instanceof ConfigError)) throw error;
            return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
    });
    server.registerTool('explain_rule', {
        title: 'Explain an Allyproof rule',
        description: 'The docs of a Check rule, as `allyproof explain`: what fails, the WCAG criteria and failure technique, how to fix it, '
            + 'a failing and a passing example, and its proof status with evidence. Read it before fixing a Finding, so the fix removes the cause '
            + 'rather than silencing the rule. Also offered as the resource allyproof://rules/<ruleId>.',
        inputSchema: {
            ruleId: z.string().describe('The rule id of a Finding or Needs Review entry, for example image-alt or vuejs-accessibility/alt-text.'),
            languageId: z.enum(LANGUAGES).optional().describe('The language whose framework the examples are written in. Defaults to html.')
        },
        annotations: READ_ONLY
    }, ({ ruleId, languageId }) => {
        const text = explanation(ruleId, languageId);
        if (text === undefined) return { isError: true, content: [{ type: 'text', text: `No rule ${ruleId}; list_rules lists them` }] };
        return { content: [{ type: 'text', text }] };
    });
    server.registerTool('list_rules', {
        title: 'List the Allyproof rules',
        description: 'The Check\'s rules as `allyproof rules --format json`: per rule its WCAG criteria, Layer and proof status per language. '
            + 'Only a rule Proven in a language reports Findings there; its other matches are Needs Review entries.',
        inputSchema: {},
        annotations: READ_ONLY
    }, () => ({ content: [{ type: 'text', text: JSON.stringify(ruleList(), null, 2) }] }));
    for (const ruleId of documentedRules()) {
        const uri = `allyproof://rules/${ruleId}`;
        server.registerResource(ruleId, uri, { title: ruleId, description: ruleDoc(ruleId)!.message, mimeType: 'text/plain' },
            () => ({ contents: [{ uri, mimeType: 'text/plain', text: explanation(ruleId)! }] }));
    }
    server.registerPrompt('allyproof_review', {
        title: 'Allyproof review',
        description: 'The Allyproof Skill: review frontend code for WCAG 2.2 AA with the check, fix, re-check loop.'
    }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: SKILL } }] }));
    const transport = new StdioServerTransport();
    const closed = new Promise<void>(resolve => { transport.onclose = resolve; });
    await server.connect(transport);
    process.stdin.once('end', () => void server.close());
    await closed;
    return 0;
}

interface CheckInput {
    paths?: string[];
    code?: string;
    path?: string;
    languageId?: string;
    limit?: number;
}

// The roots as real directories: those the client sends, or the fallback when it declares no roots or sends an empty
// list. A root that is not a local directory is skipped, never replaced by the fallback.
async function rootsOf(server: McpServer, fallback: string): Promise<string[]> {
    if (!server.server.getClientCapabilities()?.roots) return [fs.realpathSync(fallback)];
    const { roots } = await server.server.listRoots();
    if (roots.length === 0) return [fs.realpathSync(fallback)];
    return roots.flatMap(root => {
        try {
            const dir = fs.realpathSync(fileURLToPath(root.uri));
            return fs.statSync(dir).isDirectory() ? [dir] : [];
        } catch {
            return [];
        }
    });
}

// The root, the sources to check, and whether a folder is among them
function sourcesOf(roots: string[], input: CheckInput): { root: string; sources: Source[]; folder: boolean } {
    if (input.code !== undefined) {
        if (input.paths) throw new Refused('Pass either paths or code, not both');
        if (input.path === undefined && input.languageId === undefined) throw new Refused('code needs path or languageId');
        const { root, file } = input.path === undefined ? { root: anyRoot(roots), file: '(code)' } : locate(roots, input.path);
        if (input.languageId === undefined && !workspaceLanguageId(file)) throw new Refused(`${input.path} is not a file the Check analyses; pass languageId`);
        const code = input.code;
        return { root, sources: [{ file, read: () => code, languageId: input.languageId }], folder: false };
    }
    if (!input.paths?.length) throw new Refused('Pass paths, or code with path or languageId');
    const located = input.paths.map(p => {
        const at = locate(roots, p, true);
        if (!fs.existsSync(path.join(at.root, at.file))) throw new Refused(`${p} does not exist`);
        return { input: p, ...at };
    });
    const root = located[0].root;
    if (located.some(at => at.root !== root)) throw new Refused('The paths are in different roots; check one root at a time');
    let folder = false;
    const files = located.flatMap(({ input: p, file }) => {
        const stat = fs.statSync(path.join(root, file));
        if (stat.isFile()) {
            if (file === '') throw new Refused(`${p} is not a file`);
            return [file];
        }
        if (!stat.isDirectory()) throw new Refused(`${p} is not a file or folder`);
        folder = true;
        // The command line's discovery; a symlink in the folder that leaves the project is left out
        return treeFiles(root, [file]).filter(found => inside(root, found) !== undefined);
    });
    return { root, sources: [...new Set(files)].map(file => diskSource(root, file)), folder };
}

function anyRoot(roots: string[]): string {
    if (roots.length === 0) throw new Refused('The client sent no root that is a local folder');
    return roots[0];
}

// The root `p` is in and its root-relative path: the first root that holds the file, else the first it would be inside
function locate(roots: string[], p: string, rootAllowed = false): { root: string; file: string } {
    const candidates = roots.flatMap(root => {
        const file = inside(root, p, rootAllowed);
        return file === undefined ? [] : [{ root, file }];
    });
    const found = candidates.find(at => fs.existsSync(path.join(at.root, at.file))) ?? candidates[0];
    if (!found) throw new Refused(`${p} is outside the project${roots.length === 1 ? ` ${roots[0]}` : ` roots ${roots.join(', ')}`}`);
    return found;
}

// The root-relative path of `p`, or undefined when it, or what a symlink on its way points to, leaves the root;
// the root itself ('') only when `rootAllowed`
function inside(root: string, p: string, rootAllowed = false): string | undefined {
    const relative = path.relative(root, realPath(path.resolve(root, p)));
    if ((relative === '' && !rootAllowed) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
    return posix(relative);
}

// The real path of a file that may not exist yet: its nearest existing ancestor resolved, the rest appended
function realPath(absolute: string): string {
    if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
    const parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(realPath(parent), path.basename(absolute));
}

// The root's settings, refused when .vscode/settings.json is a symlink out of the root
function settingsIn(root: string) {
    const file = path.join(root, '.vscode', 'settings.json');
    if (fs.existsSync(file) && inside(root, file) === undefined) throw new Refused(`${file} is outside the project ${root}`);
    return settingsOf(root);
}

// A folder's result: the counts over every file, the files cut to `limit`
function limited(output: CheckOutput, limit: number): CheckOutput {
    const count = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
    const byFile: Record<string, number> = {};
    const byRule: Record<string, number> = {};
    const byCriterion: Record<string, number> = {};
    for (const file of output.files) {
        for (const finding of file.findings) {
            count(byFile, file.file);
            count(byRule, finding.ruleId);
            for (const criterion of finding.criteria) count(byCriterion, criterion);
        }
    }
    const truncated = output.files.length > limit;
    return {
        ...output,
        files: output.files.slice(0, limit),
        summary: { ...output.summary, byFile, byRule, byCriterion },
        truncated,
        ...truncated ? {
            hint: `Lists the first ${limit} of ${output.files.length} files. summary.byFile names the files with Findings: pass those as paths, `
                + 'or a narrower folder, or raise limit; summary.byRule says which rules to fix first.'
        } : {}
    };
}
