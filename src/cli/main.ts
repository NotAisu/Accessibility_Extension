import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import { AnalysisWorker } from '../analysis-worker';
import { checkLanguageId, isChecked, proofOf, type AnalysisOptions, type Severity } from '../core/analysis';
import { documentedRules, frameworkOf, ruleDoc } from '../core/rule-docs';
import { workspaceLanguageId } from '../workspace-check';
import { baselineOf, elementOf, matchBaseline, parseBaseline, type Baseline } from './baseline';
import { fileOutput, SCHEMA_VERSION, sarif, text, type CheckOutput, type FileOutput } from './output';
import { ConfigError, optionsFromSettings } from './settings';
import manifest from '../../package.json';

// The command line (#79): the Check of the editor as a second front end on the analysis core. No AI, no network,
// and the checked project is data, never executed.

const EXIT = { clean: 0, blocking: 1, usage: 2, unchecked: 3 } as const;
const SEVERITY_RANK: Record<Severity, number> = { information: 1, warning: 2, error: 3 };
const DEFAULT_BASELINE = '.allyproof-baseline.json';
const VERSION = manifest.version;

const USAGE = `Usage:
  allyproof check [paths…] [--staged | --changed <base> | --stdin --stdin-filename <path>]
                  [--format text|json|sarif] [--fail-on error|warning|information] [--baseline <file>]
  allyproof baseline [paths…] [--baseline <file>]
  allyproof explain <rule id> [--language <language id>]
  allyproof rules [--format text|json]

Exit codes: 0 no blocking Findings, 1 blocking Findings, 2 usage or configuration error, 3 a file could not be checked.
`;

class UsageError extends Error {}

interface Source {
    /** Repository-relative path with forward slashes. */
    file: string;
    read(): string;
}

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
            help: { type: 'boolean', short: 'h' }
        }
    });
    const [command, ...args] = positionals;
    if (values.help || !command) {
        process.stdout.write(USAGE);
        return values.help ? EXIT.clean : EXIT.usage;
    }
    if (command === 'explain') return explain(args[0], values.language);
    if (command === 'rules') return rules(values.format);
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
            : text(output));
    return output.summary.failedFiles ? EXIT.unchecked : output.summary.blocking ? EXIT.blocking : EXIT.clean;
}

async function checkAll(sources: Source[], options: AnalysisOptions, baseline: Baseline | undefined, failOn: number): Promise<CheckOutput> {
    // The worker next to this script; it holds the engines, so a crash or a runaway engine never takes the run with it
    const worker = new AnalysisWorker(path.join(path.dirname(fs.realpathSync(process.argv[1])), 'worker.mjs'));
    const files: FileOutput[] = [];
    try {
        for (const source of sources) {
            const languageId = checkLanguageId(workspaceLanguageId(source.file) ?? '', source.file);
            const content = source.read();
            const document = { languageId, text: content };
            if (!isChecked(document)) continue;
            const outcome = await worker.check(source.file, document, options, { background: true });
            if (outcome.status !== 'done') {
                files.push({ file: source.file, languageId, status: 'failed', error: outcome.status === 'paused' ? outcome.reason : 'dropped', findings: [], needsReview: [] });
                continue;
            }
            const elements = outcome.result.findings.map(f => ({ ruleId: f.ruleId, file: source.file, element: elementOf(content, f) }));
            const baselined = baseline ? matchBaseline(baseline, elements, new Set()).baselined : elements.map(() => false);
            files.push(fileOutput(source.file, languageId, content, outcome.result, baselined));
        }
    } finally {
        worker.dispose();
    }
    const findings = files.flatMap(file => file.findings);
    const elements = files.flatMap(file => file.findings.map(f => ({ ruleId: f.ruleId, file: file.file, element: elementAt(sources, file.file, f.range.start.offset) })));
    return {
        schemaVersion: SCHEMA_VERSION,
        files,
        summary: {
            files: files.length,
            failedFiles: files.filter(file => file.status === 'failed').length,
            findings: findings.length,
            blocking: findings.filter(f => !f.baselined && SEVERITY_RANK[f.severity] >= failOn).length,
            baselined: findings.filter(f => f.baselined).length,
            fixedSinceBaseline: baseline ? matchBaseline(baseline, elements, new Set(files.map(file => file.file))).fixed : 0,
            needsReview: files.reduce((sum, file) => sum + file.needsReview.length, 0)
        }
    };
}

function elementAt(sources: Source[], file: string, offset: number): string {
    const content = sources.find(source => source.file === file)!.read();
    return elementOf(content, { range: { start: offset, end: offset } });
}

function git(root: string, args: string[]): string {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function repositoryRoot(): string {
    try {
        return git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
    } catch {
        return process.cwd();
    }
}

const isRepository = (root: string) => fs.existsSync(path.join(root, '.git'));
const posix = (file: string) => file.split(path.sep).join('/');

function settingsOf(root: string): AnalysisOptions {
    const file = path.join(root, '.vscode', 'settings.json');
    return fs.existsSync(file) ? optionsFromSettings(fs.readFileSync(file, 'utf-8'), posix(path.relative(process.cwd(), file)) || file) : {};
}

function readBaseline(file: string): Baseline {
    try {
        return parseBaseline(fs.readFileSync(file, 'utf-8'));
    } catch (error) {
        throw new ConfigError(`The baseline ${file} cannot be read: ${(error as Error).message}`);
    }
}

// Read lazily and once: a file is read when it is checked
function diskSource(root: string, file: string): Source {
    let content: string | undefined;
    return { file, read: () => content ??= fs.readFileSync(path.join(root, file), 'utf-8') };
}

// The files Git does not ignore, or every file outside node_modules in a folder that is not a repository
function treeSources(root: string, paths: string[]): Source[] {
    const prefixes = paths.map(p => posix(path.relative(root, path.resolve(p))));
    const inside = (file: string) => prefixes.some(prefix => prefix === '' || file === prefix || file.startsWith(`${prefix}/`));
    const files = isRepository(root)
        ? git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
        : walk(root, '');
    for (const prefix of prefixes) {
        if (prefix.startsWith('..') || !fs.existsSync(path.join(root, prefix))) throw new UsageError(`${prefix || '.'} is not in ${root}`);
    }
    return files.filter(file => inside(file) && workspaceLanguageId(file) && fs.existsSync(path.join(root, file))).sort().map(file => diskSource(root, file));
}

function walk(root: string, dir: string): string[] {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const file = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
        return entry.isDirectory() ? walk(root, file) : [file];
    });
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
    const doc = ruleDoc(ruleId);
    if (!doc) throw new UsageError(`No rule ${ruleId}; \`allyproof rules\` lists them`);
    const example = doc.examples[frameworkOf(languageId)];
    process.stdout.write([
        `${ruleId}: ${doc.message}`,
        '',
        `WCAG: ${doc.wcag.map(link => `${link.title} (${link.url})`).join('; ')}`,
        '',
        `Why: ${doc.why}`,
        '',
        `How to fix: ${doc.fix}`,
        '',
        `Fails${example.file ? `, in ${example.file}` : ''}:`,
        indent(example.bad),
        '',
        'Passes:',
        indent(example.good),
        '',
        `Proof: ${proofLine(ruleId)}`,
        ''
    ].join('\n'));
    return EXIT.clean;
}

const indent = (code: string) => code.split('\n').map(line => `    ${line}`).join('\n');

function proofLine(ruleId: string): string {
    const languages = proofsOf(ruleId);
    if (languages.length === 0) return 'no evidence yet, so its matches are listed as Needs Review';
    return languages.map(({ languageId, proof }) => `${languageId} ${proof.proven ? 'Proven' : 'Unproven'} (${proof.correct} of ${proof.correct + proof.wrong} correct, precision at least ${(proof.lowerBound * 100).toFixed(1)} %)`).join('; ');
}

const LANGUAGES = ['html', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'angular', 'typescript'];

function proofsOf(ruleId: string) {
    return LANGUAGES.flatMap(languageId => {
        const proof = proofOf(ruleId, languageId);
        return proof ? [{ languageId, proof }] : [];
    });
}

function rules(format: string): number {
    const list = documentedRules().map(ruleId => ({
        ruleId,
        criteria: ruleDoc(ruleId)!.wcag.map(link => link.criterion),
        layer: 'check' as const,
        proof: Object.fromEntries(proofsOf(ruleId).map(({ languageId, proof }) => [languageId, proof]))
    }));
    if (format === 'json') {
        process.stdout.write(JSON.stringify({ schemaVersion: SCHEMA_VERSION, rules: list }, null, 2) + '\n');
    } else if (format === 'text') {
        for (const rule of list) {
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
