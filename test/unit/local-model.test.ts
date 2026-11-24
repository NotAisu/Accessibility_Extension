import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { ModelError, ReviewCache, review } from '../../src/review/ai-review';
import { selectLocalModel } from '../../src/review/local-model';
import type { Finding } from '../../src/core/analysis';

const document = { languageId: 'html', text: '<main>\n  <b>Our products</b>\n</main>' };
const skill = { text: 'Review WCAG 2.2.' };

interface Received {
    method?: string;
    url?: string;
    body: Record<string, unknown>;
}

type Handler = (received: Received, response: http.ServerResponse) => void;

/**
 * An OpenAI-compatible server as LM Studio and Ollama run it, listing `models` (or answering the listing with a handler)
 * and answering chat completions with `chat`. Other paths get Ollama's plain-text 404.
 */
async function localServer(models: string[] | Handler, chat: Handler) {
    const received: Received[] = [];
    const server = http.createServer((request, response) => {
        let data = '';
        request.on('data', (chunk: Buffer) => data += chunk.toString());
        request.on('end', () => {
            const entry = { method: request.method, url: request.url, body: data ? JSON.parse(data) as Record<string, unknown> : {} };
            received.push(entry);
            if (request.url === '/v1/models') {
                return typeof models === 'function' ? models(entry, response) : json(response, 200, { object: 'list', data: models.map(id => ({ id, object: 'model' })) });
            }
            if (request.url === '/v1/chat/completions') return chat(entry, response);
            response.writeHead(404, { 'content-type': 'text/plain' });
            response.end('404 page not found');
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        endpoint: `http://127.0.0.1:${port}/v1`,
        received,
        close: () => new Promise<void>(resolve => {
            server.closeAllConnections();
            server.close(() => resolve());
        })
    };
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}

function answer(content: string): Handler {
    return (_, response) => json(response, 200, { choices: [{ message: { role: 'assistant', content } }] });
}

function memoryCache(): ReviewCache {
    const entries = new Map<string, Finding[]>();
    return { get: key => entries.get(key), set: (key, findings) => void entries.set(key, findings) };
}

const entry = { line: 2, criterion: '1.3.1', message: 'Bold text is used as a heading.', recommendation: 'Use h2.', confidence: 0.9 };

describe('local model', () => {
    let server: Awaited<ReturnType<typeof localServer>> | undefined;
    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    it('reviews through the chat completions endpoint with the report schema as response_format', async () => {
        server = await localServer(['qwen2.5-coder'], answer(JSON.stringify({ findings: [entry] })));
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'qwen2.5-coder' });

        const { findings } = await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });

        assert.deepStrictEqual(findings.map(f => [f.message, f.criteria]), [['Bold text is used as a heading.', ['1.3.1']]]);
        const chat = server.received.find(r => r.url === '/v1/chat/completions');
        assert.strictEqual(chat?.method, 'POST');
        assert.strictEqual(chat.body.model, 'qwen2.5-coder');
        const format = chat.body.response_format as { type: string; json_schema: { name: string; schema: { required: string[] } } };
        assert.strictEqual(format.type, 'json_schema');
        assert.strictEqual(format.json_schema.name, 'report_findings');
        assert.deepStrictEqual(format.json_schema.schema.required, ['findings']);
        const messages = chat.body.messages as { role: string; content: string }[];
        assert.ok(messages.every(m => m.role === 'user'));
        assert.ok(messages[0].content.includes(skill.text));
    });

    it('says how to start the local server when nothing answers at the endpoint', async () => {
        server = await localServer([], answer('{}'));
        const { endpoint } = server;
        await server.close();
        server = undefined;

        await assert.rejects(selectLocalModel({ endpoint, model: 'qwen2.5-coder' }), (error: ModelError) =>
            error.code === 'Unreachable' && error.message.includes(endpoint) && /LM Studio|Ollama/.test(error.message));
    });

    it('names the models the server has when the configured one is not among them', async () => {
        server = await localServer(['llama3.2', 'qwen2.5-coder'], answer('{}'));

        await assert.rejects(selectLocalModel({ endpoint: server.endpoint, model: 'mistral' }), (error: ModelError) =>
            error.code === 'NoModel' && /mistral/.test(error.message) && /llama3\.2, qwen2\.5-coder/.test(error.message));
    });

    it('uses the first model the server lists when no model is configured', async () => {
        server = await localServer(['llama3.2', 'qwen2.5-coder'], answer(JSON.stringify({ findings: [] })));

        const model = await selectLocalModel({ endpoint: server.endpoint, model: '' });
        await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });

        assert.strictEqual(server.received.find(r => r.url === '/v1/chat/completions')?.body.model, 'llama3.2');
        assert.match(model.id, /llama3\.2/);
    });

    it('reports rate limiting without retrying', async () => {
        server = await localServer(['qwen2.5-coder'], (_, response) => json(response, 429, { error: { message: 'Too many requests' } }));
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'qwen2.5-coder' });

        await assert.rejects(review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() }),
            (error: ModelError) => error.code === 'Blocked');
        assert.strictEqual(server.received.filter(r => r.url === '/v1/chat/completions').length, 1);
    });

    it('retries once after a server error', async () => {
        let calls = 0;
        server = await localServer(['qwen2.5-coder'], (received, response) => ++calls === 1
            ? json(response, 500, { error: { message: 'Model crashed' } })
            : answer(JSON.stringify({ findings: [entry] }))(received, response));
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'qwen2.5-coder' });

        const { findings } = await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });

        assert.strictEqual(findings.length, 1);
        assert.strictEqual(calls, 2);
    });

    it('asks for a repair when the answer is not JSON', async () => {
        let calls = 0;
        server = await localServer(['qwen2.5-coder'], (received, response) =>
            answer(++calls === 1 ? 'Here are the findings: none' : JSON.stringify({ findings: [entry] }))(received, response));
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'qwen2.5-coder' });

        const { findings } = await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });

        assert.strictEqual(findings.length, 1);
        const [, repair] = server.received.filter(r => r.url === '/v1/chat/completions');
        const messages = repair.body.messages as { content: string }[];
        assert.match(messages[messages.length - 1].content, /did not follow the contract/);
    });

    it('aborts the request to a model that misses the deadline', async () => {
        let aborted!: () => void;
        const closed = new Promise<void>(resolve => aborted = resolve);
        server = await localServer(['qwen2.5-coder'], (_, response) => response.on('close', aborted));
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'qwen2.5-coder' });

        await assert.rejects(review({ document, checkFindings: [] }, { model, skill, cache: memoryCache(), deadlineMs: 50 }),
            (error: ModelError) => error.code === 'Timeout');
        await closed;
    });

    it('asks to load a model when the server has none', async () => {
        server = await localServer([], answer('{}'));

        await assert.rejects(selectLocalModel({ endpoint: server.endpoint, model: '' }), (error: ModelError) =>
            error.code === 'NoModel' && /load|pull/i.test(error.message));
    });

    it('says to check the endpoint when the server has no OpenAI-compatible API there', async () => {
        server = await localServer(['qwen2.5-coder'], answer('{}'));
        const endpoint = server.endpoint.replace(/\/v1$/, '');

        await assert.rejects(selectLocalModel({ endpoint, model: '' }), (error: ModelError) =>
            error.code === 'NotFound' && error.message.includes(endpoint) && /\/v1/.test(error.message));
    });

    it('gives up listing the models of a server that misses the deadline', async () => {
        let aborted!: () => void;
        const closed = new Promise<void>(resolve => aborted = resolve);
        server = await localServer((_, response) => response.on('close', aborted), answer('{}'));

        await assert.rejects(selectLocalModel({ endpoint: server.endpoint, model: '' }, { deadlineMs: 50 }),
            (error: ModelError) => error.code === 'Timeout' && error.message.includes(server!.endpoint));
        await closed;
    });

    it('stops listing the models when the AI Review is cancelled', async () => {
        const controller = new AbortController();
        server = await localServer(() => controller.abort(), answer('{}'));

        await assert.rejects(selectLocalModel({ endpoint: server.endpoint, model: '' }, { signal: controller.signal }),
            (error: ModelError) => error.code === 'Cancelled');
    });

    it('falls back to tool calling when the server reports structured output is unavailable', async () => {
        server = await localServer(['gemma4:e2b'], (received, response) => {
            if (received.body.response_format) {
                return json(response, 500, { error: { message: 'structured output is unavailable' } });
            }
            return json(response, 200, {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: { name: 'report_findings', arguments: JSON.stringify({ findings: [entry] }) }
                        }]
                    }
                }]
            });
        });
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'gemma4:e2b' });

        const first = await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });
        const second = await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });

        assert.deepStrictEqual(first.findings.map(f => [f.message, f.criteria]), [['Bold text is used as a heading.', ['1.3.1']]]);
        assert.deepStrictEqual(second.findings.map(f => [f.message, f.criteria]), [['Bold text is used as a heading.', ['1.3.1']]]);
        const chats = server.received.filter(r => r.url === '/v1/chat/completions');
        // First review tries response_format then falls back to tools; second review uses tools directly
        assert.strictEqual(chats.length, 3);
        assert.ok(chats[0].body.response_format);
        assert.strictEqual(chats[1].body.response_format, undefined);
        const tools = chats[1].body.tools as { type: string; function: { name: string; parameters: { required: string[] } } }[];
        assert.strictEqual(tools[0].type, 'function');
        assert.strictEqual(tools[0].function.name, 'report_findings');
        assert.deepStrictEqual(tools[0].function.parameters.required, ['findings']);
        assert.deepStrictEqual(chats[1].body.tool_choice, { type: 'function', function: { name: 'report_findings' } });
        assert.strictEqual(chats[2].body.response_format, undefined);
    });

    it('asks for a repair when a tool-calling reply has no valid JSON arguments', async () => {
        let calls = 0;
        server = await localServer(['gemma4:e2b'], (received, response) => {
            if (received.body.response_format) {
                return json(response, 500, { error: { message: 'structured output is unavailable' } });
            }
            calls++;
            const args = calls === 1 ? 'not json' : JSON.stringify({ findings: [entry] });
            return json(response, 200, {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: '',
                        tool_calls: [{ id: `call_${calls}`, type: 'function', function: { name: 'report_findings', arguments: args } }]
                    }
                }]
            });
        });
        const model = await selectLocalModel({ endpoint: server.endpoint, model: 'gemma4:e2b' });

        const { findings } = await review({ document, checkFindings: [] }, { model, skill, cache: memoryCache() });

        assert.strictEqual(findings.length, 1);
        assert.strictEqual(calls, 2);
    });
});
