import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { workspaceLanguageId } from '../workspace-check';
import { checkAll, diskSource, LANGUAGES, posix, settingsOf, SEVERITY_RANK, treeFiles, type Source } from './check';
import type { CheckOutput } from './output';
import { ConfigError } from './settings';

// `allyproof mcp` (#46): the Check as MCP tools over stdio, the third front end on the analysis core. It returns the
// command line's JSON result, reads only files inside the working directory, writes nothing and makes no network
// requests; the checked files and the settings are data, never executed (ADR 0002).

/** A request the tool refuses, reported to the agent as a tool error. */
class Refused extends Error {}

/** How many files a folder's result lists by default; the summary always covers every file. */
const DEFAULT_LIMIT = 20;

const CHECK_DESCRIPTION = 'Runs Allyproof\'s deterministic WCAG 2.2 AA Check and returns the JSON result of `allyproof check --format json` '
    + '(schema version 1): Findings of Proven rules with line, WCAG criteria, rule, message, help URL and exact `fix` edits where there are any, '
    + 'and the Needs Review entries the Check cannot decide from source. Pass `paths` to check files or folders of the project, or `code` with `path` '
    + '(or `languageId`) to check proposed code before writing it. The project\'s .vscode/settings.json rule settings, Component Mapping and '
    + 'ignore comments apply. A file that cannot be checked (parse error, engine failure) is a tool error, never an empty result. '
    + 'For folders the summary counts Findings per file, rule and criterion over every file, while `files` lists only the first files up to '
    + '`limit`; `truncated` says whether files were left out and `hint` how to narrow down.';

/** Serves the MCP server on stdin and stdout until the client disconnects; paths resolve inside `root`. */
export async function serve(root: string, version: string): Promise<number> {
    const server = new McpServer({ name: 'allyproof', version });
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async input => {
        try {
            const { sources, folder } = sourcesOf(fs.realpathSync(root), input);
            const checked = await checkAll(sources, settingsOf(root), undefined, SEVERITY_RANK.warning);
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

// The sources to check, and whether a folder is among them
function sourcesOf(root: string, input: CheckInput): { sources: Source[]; folder: boolean } {
    if (input.code !== undefined) {
        if (input.paths) throw new Refused('Pass either paths or code, not both');
        if (input.path === undefined && input.languageId === undefined) throw new Refused('code needs path or languageId');
        const file = input.path === undefined ? '(code)' : inside(root, input.path);
        if (input.languageId === undefined && !workspaceLanguageId(file)) throw new Refused(`${input.path} is not a file the Check analyses; pass languageId`);
        const code = input.code;
        return { sources: [{ file, read: () => code, languageId: input.languageId }], folder: false };
    }
    if (!input.paths?.length) throw new Refused('Pass paths, or code with path or languageId');
    let folder = false;
    const files = input.paths.flatMap(p => {
        const file = inside(root, p, true);
        const absolute = path.join(root, file);
        if (!fs.existsSync(absolute)) throw new Refused(`${p} does not exist`);
        if (fs.statSync(absolute).isFile()) {
            if (file === '') throw new Refused(`${p} is not a file`);
            return [file];
        }
        if (!fs.statSync(absolute).isDirectory()) throw new Refused(`${p} is not a file or folder`);
        folder = true;
        // The command line's discovery; a symlink in the folder that leaves the project is left out
        return treeFiles(root, [file]).filter(found => isInside(root, path.join(root, found)));
    });
    return { sources: [...new Set(files)].map(file => diskSource(root, file)), folder };
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

// The root-relative path of `p`, refused when it, or the file a symlink points to, is outside the root;
// the root itself ('') only when `rootAllowed`
function inside(root: string, p: string, rootAllowed = false): string {
    const absolute = path.resolve(root, p);
    const relative = path.relative(root, fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute);
    if ((relative === '' && !rootAllowed) || !isInside(root, absolute)) throw new Refused(`${p} is outside the project ${root}`);
    return posix(relative);
}

function isInside(root: string, absolute: string): boolean {
    const relative = path.relative(root, fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute);
    return !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}
