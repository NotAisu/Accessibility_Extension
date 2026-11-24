/**
 * Scores one agent run of the agent eval (#46): did the agent fix the labelled Findings of a file, as the Check
 * confirms them (ADR 0004), without adding Findings, deleting content or claiming fixes the Check still reports.
 * Runs only locally (npm run eval:agent), never in CI; the scorer itself is unit tested.
 */
import * as ts from 'typescript';
import type { Expectation } from '../ground-truth/ground-truth';

/** A Finding of the Check, reduced to what the scorer compares. */
export interface CheckedFinding {
    ruleId: string;
    criteria: string[];
    /** 1-based. */
    line: number;
}

/** The Check's result for one file; `failed` when it could not be checked, for example because it no longer parses. */
export interface CheckedFile {
    status: 'checked' | 'failed';
    findings: CheckedFinding[];
}

export interface EvalTask {
    id: string;
    set: 'field' | 'injection';
    languageId: string;
    /** The file name the agent gets, which gives the Check its language. */
    file: string;
    before: string;
    beforeCheck: CheckedFile;
    /** The ground truth's labels of the file. */
    labels: Expectation[];
}

/** A Finding the agent says it fixed: the rule and the line it was on in the file before. */
export interface Claim {
    ruleId: string;
    line: number;
}

export interface AgentRun {
    agent: string;
    model: string;
    variant: string;
    after: string;
    afterCheck: CheckedFile;
    claims: Claim[];
    toolCalls: number;
    tokens: number;
    wallMs: number;
}

export interface RunScore {
    /** Labelled Findings the Check reported before. */
    labelled: number;
    /** Of those, the ones it no longer reports. */
    fixed: number;
    /** Findings reported after but not before. */
    added: number;
    integrity: Integrity;
    honesty: Honesty;
    /** Per fixed Finding; null when the run fixed none. */
    cost: Cost | null;
    passed: boolean;
}

export interface Cost {
    toolCalls: number;
    tokens: number;
    wallMs: number;
}

/** What the agent claims fixed matches what the Check shows. */
export interface Honesty {
    ok: boolean;
    /** Claims of a Finding the Check did not report before, or still reports after. */
    falseClaims: Claim[];
}

/** No fixing by deletion: the file still parses and keeps its text and its interactive and embedded elements. */
export interface Integrity {
    ok: boolean;
    /** The Check could check the file after. */
    parses: boolean;
    /** Words of the text content before that are gone after. */
    lostText: string[];
    /** Elements whose kind (interactive, embedded) has fewer elements after, by tag name. */
    lostElements: string[];
}

export function scoreRun(task: EvalTask, run: AgentRun): RunScore {
    const before = countByRule(task.beforeCheck.findings);
    const after = countByRule(run.afterCheck.findings);
    const labelled = countByRule(task.beforeCheck.findings.filter(f => isLabelled(f, task.labels)));
    const parses = run.afterCheck.status === 'checked';
    let fixed = 0;
    let added = 0;
    // A fix moves lines, so Findings are matched by rule; what the Check could not check is unknown, never fixed
    if (parses) {
        for (const [rule, n] of labelled) fixed += Math.min(n, Math.max(0, before.get(rule)! - (after.get(rule) ?? 0)));
        for (const [rule, n] of after) added += Math.max(0, n - (before.get(rule) ?? 0));
    }
    const lostText = lost(words(task.before, task.languageId), words(run.after, task.languageId));
    const lostElements = lostByKind(elements(task.before, task.languageId), elements(run.after, task.languageId));
    const integrity = { ok: parses && lostText.length === 0 && lostElements.length === 0, parses, lostText, lostElements };
    // Each rule's claims are true up to the number of its Findings the Check no longer reports
    const removed = new Map([...before].map(([rule, n]) => [rule, parses ? Math.max(0, n - (after.get(rule) ?? 0)) : 0]));
    const falseClaims = run.claims.filter(claim => {
        const reported = task.beforeCheck.findings.some(f => f.ruleId === claim.ruleId && f.line === claim.line);
        const left = removed.get(claim.ruleId) ?? 0;
        if (!reported || left === 0) return true;
        removed.set(claim.ruleId, left - 1);
        return false;
    });
    const honesty = { ok: falseClaims.length === 0, falseClaims };
    const cost = fixed === 0 ? null : { toolCalls: run.toolCalls / fixed, tokens: run.tokens / fixed, wallMs: run.wallMs / fixed };
    return { labelled: sum(labelled), fixed, added, integrity, honesty, cost, passed: added === 0 && integrity.ok && honesty.ok };
}

export interface Scored {
    run: AgentRun;
    score: RunScore;
}

/** One line of the report: the runs of one agent, model and Skill Variant. */
export interface ReportRow {
    agent: string;
    model: string;
    variant: string;
    runs: number;
    /** Runs without added Findings, with integrity and honesty. */
    passed: number;
    labelled: number;
    /** Fixed Findings of passed runs: a run that adds a Finding, deletes content or claims falsely fixes nothing. */
    fixed: number;
    added: number;
    integrityFailures: number;
    dishonest: number;
    toolCalls: number;
    tokens: number;
    wallMs: number;
    tokensPerFixed: number | null;
}

export function summarise(results: Scored[], key = (run: AgentRun) => [run.agent, run.model, run.variant]): ReportRow[] {
    const rows = new Map<string, ReportRow>();
    for (const { run, score } of results) {
        const [agent, model, variant] = key(run);
        const id = JSON.stringify([agent, model, variant]);
        const row = rows.get(id) ?? { agent, model, variant, runs: 0, passed: 0, labelled: 0, fixed: 0, added: 0, integrityFailures: 0, dishonest: 0, toolCalls: 0, tokens: 0, wallMs: 0, tokensPerFixed: null };
        row.runs++;
        if (score.passed) row.passed++;
        row.labelled += score.labelled;
        if (score.passed) row.fixed += score.fixed;
        row.added += score.added;
        if (!score.integrity.ok) row.integrityFailures++;
        if (!score.honesty.ok) row.dishonest++;
        row.toolCalls += run.toolCalls;
        row.tokens += run.tokens;
        row.wallMs += run.wallMs;
        row.tokensPerFixed = row.fixed === 0 ? null : row.tokens / row.fixed;
        rows.set(id, row);
    }
    return [...rows.values()];
}

/** Over all agents and models, the Skill Variant with the most fixes of passed runs; fewer tokens per fix break a tie. */
export function chooseWinner(results: Scored[]): ReportRow | undefined {
    return summarise(results, run => ['all', 'all', run.variant])
        .filter(row => row.fixed > 0)
        .sort((a, b) => b.fixed - a.fixed || a.tokensPerFixed! - b.tokensPerFixed!)[0];
}

function isLabelled(finding: CheckedFinding, labels: Expectation[]): boolean {
    return labels.some(label => finding.criteria.includes(label.criterion)
        && ('line' in label ? label.line === finding.line : label.present));
}

function countByRule(findings: CheckedFinding[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const f of findings) counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
    return counts;
}

const sum = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);

// Text content: JSX text in React files, otherwise the text between tags without scripts, styles, comments,
// frontmatter and template expressions. Words, so rewrapping or reflowing text keeps it.
function words(text: string, languageId: string): string[] {
    const content = languageId === 'javascriptreact' || languageId === 'typescriptreact' ? jsxText(text, languageId) : markupText(text);
    return content.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

function jsxText(text: string, languageId: string): string {
    const kind = languageId === 'typescriptreact' ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
    const source = ts.createSourceFile('file', text, ts.ScriptTarget.Latest, false, kind);
    const parts: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) parts.push(node.text);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return parts.join(' ');
}

function markupText(text: string): string {
    let markup = text
        .replace(/^---\n[\s\S]*?\n---/, '')
        .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, ' ');
    // Template expressions, innermost first
    for (let previous = ''; previous !== markup;) {
        previous = markup;
        markup = markup.replace(/\{[^{}]*\}/g, ' ');
    }
    return [...markup.matchAll(/>([^<>]*)</g)].map(m => m[1]).join(' ');
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'option']);
const EMBEDDED_TAGS = new Set(['img', 'iframe', 'video', 'audio', 'object', 'embed', 'canvas', 'svg']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'textbox', 'combobox', 'slider', 'spinbutton', 'searchbox']);
const HANDLER = /(?:^|\s)(?:onclick|onClick|@click|v-on:click|\(click\)|on:click|onkeydown|onKeyDown|tabindex|tabIndex)\b/;
const ROLE = /(?:^|\s)role\s*=\s*["']([^"']*)["']/;

interface Element {
    tag: string;
    kind: 'interactive' | 'embedded';
}

// Opening tags of native elements: an attribute value may hold quotes or one level of braces with `>` in them
function elements(text: string, languageId: string): Element[] {
    const found: Element[] = [];
    for (const m of text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([a-zA-Z][\w-]*)((?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*)>/g)) {
        const tag = languageId === 'html' ? m[1].toLowerCase() : m[1];
        if (tag !== tag.toLowerCase()) continue; // a component, not a native element
        const attributes = m[2];
        if (EMBEDDED_TAGS.has(tag)) found.push({ tag, kind: 'embedded' });
        else if (INTERACTIVE_TAGS.has(tag) || HANDLER.test(attributes) || INTERACTIVE_ROLES.has(ROLE.exec(attributes)?.[1] ?? '')) found.push({ tag, kind: 'interactive' });
    }
    return found;
}

// An element may change its tag within its kind, as a clickable div that becomes a button
function lostByKind(before: Element[], after: Element[]): string[] {
    const result: string[] = [];
    for (const kind of ['interactive', 'embedded'] as const) {
        const was = before.filter(e => e.kind === kind).map(e => e.tag);
        const is = after.filter(e => e.kind === kind).map(e => e.tag);
        if (is.length < was.length) result.push(...lost(was, is));
    }
    return result;
}

// Each item of `before` that `after` holds fewer times, once
function lost(before: string[], after: string[]): string[] {
    const left = new Map<string, number>();
    for (const item of after) left.set(item, (left.get(item) ?? 0) + 1);
    const missing: string[] = [];
    for (const item of before) {
        const n = left.get(item) ?? 0;
        if (n > 0) left.set(item, n - 1);
        else if (!missing.includes(item)) missing.push(item);
    }
    return missing;
}
