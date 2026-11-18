/** What AI Review needs to know of a Copilot chat model to choose one. */
export interface CopilotModelInfo {
    readonly id: string;
    readonly family: string;
    readonly name: string;
}

/**
 * Copilot models for AI Review, cheapest capable first. Copilot bills by tokens (AI Credits), and a review
 * is a forced tool call over one file, which these small models do well at about a tenth of a default model's price.
 * Plans that lack the first choice fall through to the next; the last are the older 0x models of legacy plans.
 */
export const COPILOT_REVIEW_MODELS = ['claude-haiku-5.5', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-mini'];

/** Tokens a model may carry besides its family's and still be that model. */
const LABELS = new Set(['preview']);

const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isModel(model: CopilotModelInfo, preferred: string): boolean {
    const wanted = tokens(preferred);
    return [model.family, model.id, model.name].some(text => {
        const own = tokens(text);
        return wanted.every((token, index) => own[index] === token) && own.slice(wanted.length).every(token => LABELS.has(token));
    });
}

/** The first preferred model Copilot offers, else the first it lists, else undefined. */
export function pickCopilotModel<Model extends CopilotModelInfo>(models: readonly Model[]): Model | undefined {
    for (const preferred of COPILOT_REVIEW_MODELS) {
        const match = models.find(model => isModel(model, preferred));
        if (match) return match;
    }
    return models[0];
}
