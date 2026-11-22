/**
 * The agent eval's Claude Code adapter: runs `claude -p` in a task's folder with the Allyproof MCP server and a Skill
 * Variant as the project's Skill, and reads its answer, claims and cost from the stream-json transcript.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Claim } from './scorer';

export interface AgentTask {
    /** The folder the agent works in; it holds only the task's file. */
    dir: string;
    file: string;
    prompt: string;
    /** The text of the Skill Variant. */
    skill: string;
    /** Starts `allyproof mcp` in the task's folder. */
    mcp: { command: string; args: string[] };
    deadlineMs: number;
}

export interface AgentOutcome {
    answer: string;
    claims: Claim[];
    toolCalls: number;
    tokens: number;
    wallMs: number;
}

export interface AgentPort {
    agent: string;
    model: string;
    run(task: AgentTask): Promise<AgentOutcome>;
}

/** The tools the agent may use: read and edit the file, the Skill and the Check. No shell and no web. */
const ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'mcp__allyproof__check'];

export function claudeCode(model: string): AgentPort {
    return {
        agent: 'claude-code',
        model,
        async run(task) {
            const skillDir = path.join(task.dir, '.claude', 'skills', 'allyproof');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), task.skill);
            // Outside the task folder, so the agent sees only its file and the Skill
            const mcpConfig = `${task.dir}.mcp.json`;
            fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { allyproof: { type: 'stdio', ...task.mcp } } }));
            try {
                const transcript = await run('claude', [
                    '-p', task.prompt,
                    '--model', model,
                    '--output-format', 'stream-json',
                    '--verbose',
                    '--mcp-config', mcpConfig,
                    '--strict-mcp-config',
                    // Only the task's project: the user's own CLAUDE.md, Skills and settings stay out of the run
                    '--setting-sources', 'project',
                    '--permission-mode', 'acceptEdits',
                    '--allowedTools', ...ALLOWED_TOOLS,
                    '--disallowedTools', 'Bash', 'WebFetch', 'WebSearch', 'Task'
                ], task.dir, task.deadlineMs);
                const outcome = parseTranscript(transcript);
                return { ...outcome, claims: parseClaims(outcome.answer) };
            } finally {
                fs.rmSync(mcpConfig, { force: true });
            }
        }
    };
}

/** The answer, tool calls, tokens (input, output and cache) and wall time of a `claude -p --output-format stream-json` run. */
export function parseTranscript(transcript: string): Omit<AgentOutcome, 'claims'> {
    let toolCalls = 0;
    let result: { result?: string; duration_ms?: number; usage?: Record<string, number> } | undefined;
    for (const line of transcript.split('\n')) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { type: string; message?: { content?: { type: string }[] } };
        if (message.type === 'assistant') toolCalls += (message.message?.content ?? []).filter(c => c.type === 'tool_use').length;
        if (message.type === 'result') result = message as typeof result;
    }
    if (!result) throw new Error('The Claude Code transcript has no result');
    const usage = result.usage ?? {};
    const tokens = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((sum, key) => sum + (usage[key] ?? 0), 0);
    return { answer: result.result ?? '', toolCalls, tokens, wallMs: result.duration_ms ?? 0 };
}

/** The fixes the agent claims, from the last ```json block of its answer: `{"fixed": [{"ruleId", "line"}]}`. */
export function parseClaims(answer: string): Claim[] {
    const block = [...answer.matchAll(/```json\s*([\s\S]*?)```/g)].pop()?.[1];
    if (block === undefined) return [];
    try {
        const fixed = (JSON.parse(block) as { fixed?: unknown }).fixed;
        if (!Array.isArray(fixed)) return [];
        return (fixed as Partial<Record<keyof Claim, unknown>>[])
            .filter((c): c is Claim => typeof c?.ruleId === 'string' && Number.isInteger(c?.line))
            .map(c => ({ ruleId: c.ruleId, line: c.line }));
    } catch {
        return [];
    }
}

function run(command: string, args: string[], cwd: string, deadlineMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.setEncoding('utf-8').on('data', chunk => { out += chunk; });
        const timer = setTimeout(() => child.kill(), deadlineMs);
        child.on('error', reject);
        child.on('exit', code => {
            clearTimeout(timer);
            if (code === 0) resolve(out);
            else reject(new Error(`${command} exited with ${code ?? 'a signal'}`));
        });
    });
}
