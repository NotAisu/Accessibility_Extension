import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { workspaceLanguageId } from '../workspace-check';
import { checkAll, diskSource, LANGUAGES, posix, settingsOf, SEVERITY_RANK, type Source } from './check';
import { ConfigError } from './settings';

// `allyproof mcp` (#46): the Check as MCP tools over stdio, the third front end on the analysis core. It returns the
// command line's JSON result, reads only files inside the client's MCP roots (#97), writes nothing and makes no network
// requests; the checked files and the settings are data, never executed (ADR 0002). Each root is a project as the
// editor sees a workspace folder: its .vscode/settings.json applies and results name files relative to it.

/** A request the tool refuses, reported to the agent as a tool error. */
class Refused extends Error {}

const CHECK_DESCRIPTION = 'Runs Allyproof\'s deterministic WCAG 2.2 AA Check and returns the JSON result of `allyproof check --format json` '
    + '(schema version 1): Findings of Proven rules with line, WCAG criteria, rule, message, help URL and exact `fix` edits where there are any, '
    + 'and the Needs Review entries the Check cannot decide from source. Pass `paths` to check files of the project, or `code` with `path` '
    + '(or `languageId`) to check proposed code before writing it. The project\'s .vscode/settings.json rule settings, Component Mapping and '
    + 'ignore comments apply. A file that cannot be checked (parse error, engine failure) is a tool error, never an empty result.';

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
            paths: z.array(z.string()).optional().describe('Files to check, relative to the project or absolute inside it.'),
            code: z.string().optional().describe('Proposed code to check instead of a file\'s text.'),
            path: z.string().optional().describe('The file the code is for; its extension gives the language and the result names it.'),
            languageId: z.enum(LANGUAGES).optional().describe('The language of code, for example html, vue or typescriptreact. Defaults to the language of path.')
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async input => {
        try {
            const { root, sources } = sourcesOf(await currentRoots(), input);
            const output = await checkAll(sources, settingsIn(root), undefined, SEVERITY_RANK.warning);
            const json = { type: 'text' as const, text: JSON.stringify(output, null, 2) };
            const failed = output.files.filter(file => file.status === 'failed');
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

function sourcesOf(roots: string[], input: CheckInput): { root: string; sources: Source[] } {
    if (input.code !== undefined) {
        if (input.paths) throw new Refused('Pass either paths or code, not both');
        if (input.path === undefined && input.languageId === undefined) throw new Refused('code needs path or languageId');
        const { root, file } = input.path === undefined ? { root: anyRoot(roots), file: '(code)' } : locate(roots, input.path);
        if (input.languageId === undefined && !workspaceLanguageId(file)) throw new Refused(`${input.path} is not a file the Check analyses; pass languageId`);
        const code = input.code;
        return { root, sources: [{ file, read: () => code, languageId: input.languageId }] };
    }
    if (!input.paths?.length) throw new Refused('Pass paths, or code with path or languageId');
    const located = input.paths.map(p => {
        const at = locate(roots, p);
        if (!fs.existsSync(path.join(at.root, at.file))) throw new Refused(`${p} does not exist`);
        if (!fs.statSync(path.join(at.root, at.file)).isFile()) throw new Refused(`${p} is not a file`);
        return at;
    });
    const root = located[0].root;
    if (located.some(at => at.root !== root)) throw new Refused('The paths are in different roots; check one root at a time');
    return { root, sources: located.map(at => diskSource(root, at.file)) };
}

function anyRoot(roots: string[]): string {
    if (roots.length === 0) throw new Refused('The client sent no root that is a local folder');
    return roots[0];
}

// The root `p` is in and its root-relative path: the first root that holds the file, else the first it would be inside
function locate(roots: string[], p: string): { root: string; file: string } {
    const candidates = roots.flatMap(root => {
        const file = inside(root, p);
        return file === undefined ? [] : [{ root, file }];
    });
    const found = candidates.find(at => fs.existsSync(path.join(at.root, at.file))) ?? candidates[0];
    if (!found) throw new Refused(`${p} is outside the project${roots.length === 1 ? ` ${roots[0]}` : ` roots ${roots.join(', ')}`}`);
    return found;
}

// The root-relative path of `p`, or undefined when it, or what a symlink on its way points to, leaves the root
function inside(root: string, p: string): string | undefined {
    const relative = path.relative(root, realPath(path.resolve(root, p)));
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
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
