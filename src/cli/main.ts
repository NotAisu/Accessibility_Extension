import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import { type Severity } from '../core/analysis';
import { workspaceLanguageId } from '../workspace-check';
import { baselineOf, parseBaseline, type Baseline } from './baseline';
import { checkAll, diskSource, elementAt, git, isRepository, posix, settingsOf, SEVERITY_RANK, treeFiles, type Source } from './check';
import { serve } from './mcp';
import { explanation, ruleList } from './rules';
import { helpBanner, sarif, supportsColor, text } from './output';
import { ConfigError } from './settings';
import manifest from '../../package.json';

// The command line (#79): the Check of the editor as a second front end on the analysis core. No AI, no network,
// and the checked project is data, never executed.

const EXIT = { clean: 0, blocking: 1, usage: 2, unchecked: 3 } as const;
const DEFAULT_BASELINE = '.allyproof-baseline.json';
const VERSION = manifest.version;

const USAGE = `Usage:
  allyproof check [paths…] [--staged | --changed <base> | --stdin --stdin-filename <path>]
                  [--format text|json|sarif] [--fail-on error|warning|information] [--baseline <file>]
  allyproof baseline [paths…] [--baseline <file>]
  allyproof explain <rule id> [--language <language id>]
  allyproof rules [--format text|json]
  allyproof mcp     an MCP server over stdio for coding agents: the check, explain_rule and list_rules tools,
                    every rule's docs as a resource and the Allyproof Skill as a prompt
  allyproof --version

Exit codes: 0 no blocking Findings, 1 blocking Findings, 2 usage or configuration error, 3 a file could not be checked.
`;

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            staged: { type: 'boolean' },
            changed: { type: 'string' },
            stdin: { type: 'boolean' },
            'stdin-filename': { type: 'string' },
            format: { type: 'string', default: 'text' },
            'fail-on': { type: 'string', default: 'warning' },
            baseline: { type: 'string' },
            language: { type: 'string', default: 'html' },
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' }
        }
    });
    const [command, ...args] = positionals;
    if (values.version) {
        process.stdout.write(`${VERSION}\n`);
        return EXIT.clean;
    }
    if (values.help || !command) {
        process.stdout.write(`${helpBanner(VERSION, { color: supportsColor() })}\n${USAGE}`);
        return values.help ? EXIT.clean : EXIT.usage;
    }
    if (command === 'explain') return explain(args[0], values.language);
    if (command === 'rules') return rules(values.format);
    if (command === 'mcp') return serve(repositoryRoot(), VERSION);
    if (command !== 'check' && command !== 'baseline') throw new UsageError(`Unknown command ${command}`);
    if (!['text', 'json', 'sarif'].includes(values.format)) throw new UsageError(`--format is text, json or sarif, not ${values.format}`);
    if (!(values['fail-on'] in SEVERITY_RANK)) throw new UsageError(`--fail-on is error, warning or information, not ${values['fail-on']}`);
    if ([values.staged, values.changed !== undefined, values.stdin].filter(Boolean).length > 1) throw new UsageError('Use one of --staged, --changed and --stdin');
    if (values.stdin && !values['stdin-filename']) throw new UsageError('--stdin needs --stdin-filename <path>');

    const root = repositoryRoot();
    const options = settingsOf(root);
    const sources = values.stdin ? [stdinSource(root, values['stdin-filename']!)]
        : values.staged ? stagedSources(root)
            : values.changed !== undefined ? changedSources(root, values.changed)
                : treeSources(root, args.length ? args : ['.']);
    const baselineFile = path.resolve(root, values.baseline ?? DEFAULT_BASELINE);
    const baseline = command === 'check' && (values.baseline !== undefined || fs.existsSync(baselineFile)) ? readBaseline(baselineFile) : undefined;

    const output = await checkAll(sources, options, baseline, SEVERITY_RANK[values['fail-on'] as Severity]);
    if (command === 'baseline') {
        const findings = output.files.flatMap(file => file.findings.map(f => ({ ruleId: f.ruleId, file: file.file, element: elementAt(sources, file.file, f.range.start.offset) })));
        fs.writeFileSync(baselineFile, JSON.stringify(baselineOf(findings), null, 2) + '\n');
        process.stdout.write(`Wrote ${findings.length} Findings to ${path.relative(process.cwd(), baselineFile) || baselineFile}\n`);
        return output.summary.failedFiles ? EXIT.unchecked : EXIT.clean;
    }
    process.stdout.write(values.format === 'json' ? JSON.stringify(output, null, 2) + '\n'
        : values.format === 'sarif' ? JSON.stringify(sarif(output, VERSION), null, 2) + '\n'
            : text(output, { color: supportsColor() }));
    return output.summary.failedFiles ? EXIT.unchecked : output.summary.blocking ? EXIT.blocking : EXIT.clean;
}

function repositoryRoot(): string {
    try {
        return git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
    } catch {
        return process.cwd();
    }
}

function readBaseline(file: string): Baseline {
    try {
        return parseBaseline(fs.readFileSync(file, 'utf-8'));
    } catch (error) {
        throw new ConfigError(`The baseline ${file} cannot be read: ${(error as Error).message}`);
    }
}

function treeSources(root: string, paths: string[]): Source[] {
    const prefixes = paths.map(p => posix(path.relative(root, path.resolve(p))));
    for (const prefix of prefixes) {
        if (prefix.startsWith('..') || !fs.existsSync(path.join(root, prefix))) throw new UsageError(`${prefix || '.'} is not in ${root}`);
    }
    return treeFiles(root, prefixes).map(file => diskSource(root, file));
}

// What is about to be committed: the staged content from the index, not the working copy
function stagedSources(root: string): Source[] {
    if (!isRepository(root)) throw new UsageError('--staged needs a Git repository');
    return git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(file => file && workspaceLanguageId(file)).sort()
        .map(file => {
            let content: string | undefined;
            return { file, read: () => content ??= git(root, ['show', `:${file}`]) };
        });
}

function changedSources(root: string, base: string): Source[] {
    if (!isRepository(root)) throw new UsageError('--changed needs a Git repository');
    let changed: string;
    try {
        changed = git(root, ['diff', '--name-only', '--diff-filter=ACMR', '-z', base]);
    } catch {
        throw new UsageError(`${base} is not a commit Git knows`);
    }
    return changed.split('\0').filter(file => file && workspaceLanguageId(file) && fs.existsSync(path.join(root, file))).sort().map(file => diskSource(root, file));
}

function stdinSource(root: string, filename: string): Source {
    const content = fs.readFileSync(0, 'utf-8');
    return { file: posix(path.relative(root, path.resolve(filename))), read: () => content };
}

function explain(ruleId: string | undefined, languageId: string): number {
    if (!ruleId) throw new UsageError('explain needs a rule id; `allyproof rules` lists them');
    const text = explanation(ruleId, languageId);
    if (text === undefined) throw new UsageError(`No rule ${ruleId}; \`allyproof rules\` lists them`);
    process.stdout.write(text);
    return EXIT.clean;
}

function rules(format: string): number {
    const list = ruleList();
    if (format === 'json') {
        process.stdout.write(JSON.stringify(list, null, 2) + '\n');
    } else if (format === 'text') {
        for (const rule of list.rules) {
            const proven = Object.entries(rule.proof).filter(([, proof]) => proof.proven).map(([languageId]) => languageId);
            process.stdout.write(`${rule.ruleId}  WCAG ${rule.criteria.join(', ')}  ${proven.length ? `Proven in ${proven.join(', ')}` : 'Unproven'}\n`);
        }
    } else {
        throw new UsageError(`--format is text or json for rules, not ${format}`);
    }
    return EXIT.clean;
}

main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    (error: unknown) => {
        const known = error instanceof UsageError || error instanceof ConfigError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS');
        process.stderr.write(`allyproof: ${(error as Error).message}\n${known ? '' : (error as Error).stack ?? ''}`);
        process.exitCode = EXIT.usage;
    }
);
