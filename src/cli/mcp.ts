import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { workspaceLanguageId } from '../workspace-check';
import { checkAll, diskSource, LANGUAGES, posix, settingsOf, SEVERITY_RANK, type Source } from './check';
import { ConfigError } from './settings';

// `allyproof mcp` (#46): the Check as MCP tools over stdio, the third front end on the analysis core. It returns the
// command line's JSON result, reads only files inside the working directory, writes nothing and makes no network
// requests; the checked files and the settings are data, never executed (ADR 0002).

/** A request the tool refuses, reported to the agent as a tool error. */
class Refused extends Error {}

const CHECK_DESCRIPTION = 'Runs Allyproof\'s deterministic WCAG 2.2 AA Check and returns the JSON result of `allyproof check --format json` '
    + '(schema version 1): Findings of Proven rules with line, WCAG criteria, rule, message, help URL and exact `fix` edits where there are any, '
    + 'and the Needs Review entries the Check cannot decide from source. Pass `paths` to check files of the project, or `code` with `path` '
    + '(or `languageId`) to check proposed code before writing it. The project\'s .vscode/settings.json rule settings, Component Mapping and '
    + 'ignore comments apply. A file that cannot be checked (parse error, engine failure) is a tool error, never an empty result.';

/** Serves the MCP server on stdin and stdout until the client disconnects; paths resolve inside `root`. */
export async function serve(root: string, version: string): Promise<number> {
    const server = new McpServer({ name: 'allyproof', version });
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
            const output = await checkAll(sourcesOf(fs.realpathSync(root), input), settingsOf(root), undefined, SEVERITY_RANK.warning);
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

function sourcesOf(root: string, input: CheckInput): Source[] {
    if (input.code !== undefined) {
        if (input.paths) throw new Refused('Pass either paths or code, not both');
        if (input.path === undefined && input.languageId === undefined) throw new Refused('code needs path or languageId');
        const file = input.path === undefined ? '(code)' : inside(root, input.path);
        if (input.languageId === undefined && !workspaceLanguageId(file)) throw new Refused(`${input.path} is not a file the Check analyses; pass languageId`);
        const code = input.code;
        return [{ file, read: () => code, languageId: input.languageId }];
    }
    if (!input.paths?.length) throw new Refused('Pass paths, or code with path or languageId');
    return input.paths.map(p => {
        const file = inside(root, p);
        if (!fs.existsSync(path.join(root, file))) throw new Refused(`${p} does not exist`);
        if (!fs.statSync(path.join(root, file)).isFile()) throw new Refused(`${p} is not a file`);
        return diskSource(root, file);
    });
}

// The root-relative path of `p`, refused when it, or the file a symlink points to, is outside the root
function inside(root: string, p: string): string {
    const absolute = path.resolve(root, p);
    const relative = path.relative(root, fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute);
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Refused(`${p} is outside the project ${root}`);
    }
    return posix(relative);
}
