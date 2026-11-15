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
npm install         # on Node 24.15, the lowest supported runtime
npm run verify      # everything CI runs: lint, typecheck, unit tests, gate on source and bundle
npm run bundle      # dist/extension.mjs, dist/analysis.mjs and one chunk per language engine
npm run test:unit
npm run test:gate   # Check precision/recall per language against ground truth
npm run test:bundle-gate  # the same gate against the packaged VSIX, unpacked without node_modules
npm run package     # allyproof-<version>.vsix
```

After an intended change in Check quality, store the new scores with `npm run test:gate -- --update` and commit the changed files in `test/ground-truth/baseline/`.

Press F5 to launch an Extension Development Host. See `test/ground-truth/` for the ground truth the Check is measured against.

## License

MIT
