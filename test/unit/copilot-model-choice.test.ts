import * as assert from 'assert';
import { pickCopilotModel } from '../../src/review/copilot-model-choice';

const model = (family: string, id = family, name = family) => ({ family, id, name });

describe('Copilot model for AI Review', () => {
    it('prefers the cheapest capable model over the first one Copilot lists', () => {
        const models = [model('gpt-4o-mini'), model('gpt-4.1'), model('claude-haiku-5.5'), model('gpt-6-luna')];
        assert.strictEqual(pickCopilotModel(models)?.family, 'claude-haiku-5.5');
    });

    it('falls back along the preference list when a plan lacks the first choice', () => {
        assert.strictEqual(pickCopilotModel([model('gpt-4o-mini'), model('gpt-6-luna')])?.family, 'gpt-6-luna');
        assert.strictEqual(pickCopilotModel([model('gpt-4.1'), model('gpt-5-mini')])?.family, 'gpt-5-mini');
    });

    it('matches however Copilot spells the family, id or name', () => {
        const models = [model('gpt-4.1'), model('Claude Haiku 5.5 (Preview)', 'claude-haiku-5-5')];
        assert.strictEqual(pickCopilotModel(models)?.id, 'claude-haiku-5-5');
    });

    it('does not mistake a larger model of the same family for the cheap one', () => {
        assert.strictEqual(pickCopilotModel([model('claude-haiku-5.5-max'), model('gpt-6-luna')])?.family, 'gpt-6-luna');
    });

    it('uses the first model when none is on the preference list, and nothing when Copilot has none', () => {
        assert.strictEqual(pickCopilotModel([model('some-new-model'), model('gpt-4.1')])?.family, 'some-new-model');
        assert.strictEqual(pickCopilotModel([]), undefined);
    });
});
