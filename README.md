# Allyproof – WCAG 2.2 Accessibility Checker

Allyproof checks your frontend code against WCAG 2.2 A/AA while you work and can ask an AI model for fixes.

> Early preview. Analysis currently runs axe-core on a static parse of the file; results for HTML are the most reliable.

## Features

- **Check**: Findings appear in the Problems panel when you open or save an HTML, Vue, Svelte, JSX or TSX file. Your file is parsed, never executed.
- **Fix with AI**: a quick fix on each Finding asks your AI provider for a corrected line.
- **AI Review**: `Allyproof: Start AI Review` looks for semantic problems the Check cannot detect. Off until you enable `accessibility.aiAnalyzer.enabled`.

## AI providers

Set `accessibility.aiProvider`:

| Provider | Setting value | Needs |
|----------|---------------|-------|
| Local model (LM Studio, Ollama, any OpenAI-compatible server) | `local` | `accessibility.localLLM.endpoint` and `accessibility.localLLM.model` |
| GitHub Copilot | `github-copilot` | Copilot signed in; model via `accessibility.githubCopilot.model` |

Code is only sent to a model when you run a fix or an AI Review. Allyproof has no telemetry.

## Commands

All commands are in the Command Palette under **Allyproof**:

- Start AI Review
- Test AI Connection
- Clear Recent AI Fix Memory

## Development

```sh
npm install
npm run bundle      # dist/extension.js
npm run test:unit
npm run package     # allyproof-<version>.vsix
```

Press F5 to launch an Extension Development Host. See `test/README.md` for the fixture suites.

## License

MIT
