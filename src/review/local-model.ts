import { DEADLINE_MS, ModelError, ModelPort, ModelRequest } from './ai-review';

export interface LocalModelSettings {
    /** Base URL of an OpenAI-compatible API, for example http://localhost:1234/v1 (LM Studio) or http://localhost:11434/v1 (Ollama). */
    endpoint: string;
    model: string;
}

export interface SelectOptions {
    /** Cancels the AI Review, and with it the lookup. */
    signal?: AbortSignal;
    /** Defaults to the AI Review's deadline per model request. */
    deadlineMs?: number;
}

/** A local model behind an OpenAI-compatible endpoint; rejects with an actionable `ModelError` if it is not there. */
export async function selectLocalModel(settings: LocalModelSettings, options: SelectOptions = {}): Promise<ModelPort> {
    const endpoint = settings.endpoint.replace(/\/+$/, '');
    const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
    const lookup = new AbortController();
    const timer = setTimeout(() => lookup.abort(), deadlineMs);
    const cancel = () => lookup.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    let listed: { data?: { id: string }[] };
    try {
        if (options.signal?.aborted) lookup.abort();
        listed = await call(endpoint, '/models', { method: 'GET', signal: lookup.signal }) as typeof listed;
    } catch (error) {
        if (options.signal?.aborted) throw new ModelError('Cancelled', 'AI Review cancelled.');
        if (lookup.signal.aborted) throw new ModelError('Timeout', `The local model server at ${endpoint} did not answer within ${deadlineMs / 1000} s.`);
        throw error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
    }
    const models = (listed.data ?? []).map(model => model.id);
    if (models.length === 0) {
        throw new ModelError('NoModel', `The local model server at ${endpoint} has no model. Load one in LM Studio or pull one with Ollama.`);
    }
    if (settings.model && !models.includes(settings.model)) {
        throw new ModelError('NoModel', `The local model server at ${endpoint} has no model ${settings.model}. `
            + `Set the model to one it has: ${models.join(', ')}.`);
    }
    return new LocalModel(endpoint, settings.model || models[0]);
}

async function call(endpoint: string, path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(`${endpoint}${path}`, init);
    } catch (error) {
        if (init.signal?.aborted) throw error;
        throw new ModelError('Unreachable', `No local model server answers at ${endpoint}. Start LM Studio's server or Ollama, or correct the endpoint in the settings.`);
    }
    if (response.status === 429) {
        throw new ModelError('Blocked', `The local model server at ${endpoint} is rate limiting requests. Try again later.`);
    }
    // Error replies are not always JSON: Ollama answers a path it does not have with plain text
    const text = await response.text();
    let body: { error?: { message?: string } | string } | undefined;
    try {
        body = JSON.parse(text) as typeof body;
    } catch {
        body = undefined;
    }
    if (response.status === 404 && !body?.error) {
        throw new ModelError('NotFound', `The local model server at ${endpoint} has no OpenAI-compatible API there. `
            + 'Correct the endpoint in the settings; it usually ends in /v1.');
    }
    if (!response.ok) {
        const reason = typeof body?.error === 'string' ? body.error : body?.error?.message ?? `HTTP ${response.status}`;
        throw new ModelError('Unknown', `The local model server at ${endpoint} failed: ${reason}.`);
    }
    if (body === undefined) throw new ModelError('Unknown', `The local model server at ${endpoint} did not answer with JSON.`);
    return body;
}

// OpenAI-compatible servers report neither the context length nor a tokenizer: a context most local models
// have, and about four characters per token
const LOCAL_INPUT_TOKENS = 8192;
const CHARS_PER_TOKEN = 4;

class LocalModel implements ModelPort {
    readonly id: string;
    readonly name: string;
    readonly maxInputTokens = LOCAL_INPUT_TOKENS;
    private useTools = false;

    constructor(private readonly endpoint: string, private readonly model: string) {
        this.id = `local/${endpoint}/${model}`;
        this.name = `Local model ${model} at ${endpoint}`;
    }

    countTokens(text: string): Promise<number> {
        return Promise.resolve(Math.ceil(text.length / CHARS_PER_TOKEN));
    }

    async request(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
        if (this.useTools) return this.requestWithTools(request, signal);
        try {
            return await this.requestWithSchema(request, signal);
        } catch (error) {
            if (!isStructuredOutputUnavailable(error)) throw error;
            this.useTools = true;
            return this.requestWithTools(request, signal);
        }
    }

    private async requestWithSchema(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
        const body = await this.chatCompletion(request, signal, {
            response_format: {
                type: 'json_schema',
                json_schema: { name: request.tool.name, schema: request.tool.inputSchema }
            }
        });
        return parseJson(body.choices?.[0]?.message?.content);
    }

    private async requestWithTools(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
        const body = await this.chatCompletion(request, signal, {
            tools: [{
                type: 'function',
                function: {
                    name: request.tool.name,
                    description: request.tool.description,
                    parameters: request.tool.inputSchema
                }
            }],
            tool_choice: { type: 'function', function: { name: request.tool.name } }
        });
        const message = body.choices?.[0]?.message;
        const toolCall = message?.tool_calls?.find(c => c.function?.name === request.tool.name);
        return parseJson(toolCall?.function?.arguments ?? message?.content);
    }

    private chatCompletion(request: ModelRequest, signal: AbortSignal, extra: Record<string, unknown>): Promise<ChatCompletion> {
        return call(this.endpoint, '/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal,
            body: JSON.stringify({
                model: this.model,
                messages: request.messages.map(content => ({ role: 'user', content })),
                ...extra
            })
        }) as Promise<ChatCompletion>;
    }
}

interface ChatCompletion {
    choices?: {
        message?: {
            content?: string;
            tool_calls?: { function?: { name?: string; arguments?: string } }[];
        };
    }[];
}

function isStructuredOutputUnavailable(error: unknown): boolean {
    return error instanceof ModelError && error.code === 'Unknown'
        && /structured output|response_format/i.test(error.message);
}

function parseJson(text: string | undefined): unknown {
    if (text === undefined) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        // Not JSON despite response_format or tool_choice: the AI Review asks for a repair
        return undefined;
    }
}
