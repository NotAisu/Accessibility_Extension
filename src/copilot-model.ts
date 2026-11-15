import * as vscode from 'vscode';
import { ModelError, ModelPort, ModelRequest } from './review/ai-review';

/** The first Copilot chat model, or undefined when Copilot (or the language model API) is not available. */
export async function selectCopilotModel(): Promise<ModelPort | undefined> {
    // Editors without the language model API (some VS Code forks) simply have no AI Review
    if (typeof vscode.lm?.selectChatModels !== 'function') return undefined;
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return model && new CopilotModel(model);
}

/** Copilot through `vscode.lm`. Only call `request` from a user action: the first one asks for consent. */
class CopilotModel implements ModelPort {
    readonly id: string;
    readonly name: string;

    constructor(private readonly model: vscode.LanguageModelChat) {
        this.id = `copilot/${model.id}/${model.version}`;
        this.name = `GitHub Copilot (${model.name})`;
    }

    async request(request: ModelRequest, signal: AbortSignal): Promise<unknown> {
        const cancellation = new vscode.CancellationTokenSource();
        signal.addEventListener('abort', () => cancellation.cancel(), { once: true });
        try {
            const response = await this.model.sendRequest(
                request.messages.map(message => vscode.LanguageModelChatMessage.User(message)),
                {
                    justification: 'Allyproof reviews the current file for WCAG problems the Check cannot detect.',
                    tools: [request.tool],
                    toolMode: vscode.LanguageModelChatToolMode.Required
                },
                cancellation.token
            );
            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelToolCallPart && part.name === request.tool.name) return part.input;
            }
            return undefined;
        } catch (error) {
            if (error instanceof vscode.LanguageModelError) throw new ModelError(error.code, error.message);
            throw error;
        } finally {
            cancellation.dispose();
        }
    }
}
