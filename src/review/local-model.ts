import { ModelError, ModelPort, ModelRequest } from './ai-review';

export interface LocalModelSettings {
    /** Base URL of an OpenAI-compatible API, for example http://localhost:1234/v1 (LM Studio) or http://localhost:11434/v1 (Ollama). */
    endpoint: string;
    model: string;
}

/** A local model behind an OpenAI-compatible endpoint; rejects with an actionable `ModelError` if it is not there. */
export async function selectLocalModel(settings: LocalModelSettings): Promise<ModelPort> {
    const endpoint = settings.endpoint.replace(/\/+$/, '');
    const listed = await call(endpoint, '/models', { method: 'GET' }) as { data?: { id: string }[] };
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
    const body = await response.json() as { error?: { message?: string } | string };
    if (response.status === 429) {
        throw new ModelError('Blocked', `The local model server at ${endpoint} is rate limiting requests. Try again later.`);
    }
    if (!response.ok) {
        const reason = typeof body.error === 'string' ? body.error : body.error?.message ?? `HTTP ${response.status}`;
        throw new ModelError('Unknown', `The local model server at ${endpoint} failed: ${reason}.`);
    }
    return body;
}

class LocalModel implements ModelPort {
    readonly id: string;
    readonly name: string;

    constructor(private readonly endpoint: string, private readonly model: string) {
        this.id = `local/${endpoint}/${model}`;
        this.name = `Local model ${model} at ${endpoint}`;
    }

    async request(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
        const body = await call(this.endpoint, '/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal,
            body: JSON.stringify({
                model: this.model,
                messages: request.messages.map(content => ({ role: 'user', content })),
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: request.tool.name, schema: request.tool.inputSchema }
                }
            })
        }) as { choices?: { message?: { content?: string } }[] };
        const content = body.choices?.[0]?.message?.content;
        try {
            return content === undefined ? undefined : JSON.parse(content) as unknown;
        } catch {
            // Not JSON despite response_format: the AI Review asks for a repair
            return undefined;
        }
    }
}
