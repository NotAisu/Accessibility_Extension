# Allyproof – WCAG 2.2 Accessibility Checker

Allyproof checks your frontend code against WCAG 2.2 A/AA while you work and can ask an AI model to review it.

> Early preview. Analysis currently runs axe-core on a static parse of the file; results for HTML are the most reliable.

## Features

- **Check**: Findings appear in the Problems panel when you open or save an HTML, Vue, Svelte, JSX or TSX file. Your file is parsed, never executed.
- **AI Review**: `Allyproof: Start AI Review` asks GitHub Copilot to look for semantic problems the Check cannot detect. Its Findings appear as information marked "AI"; progress and the result are shown in the status bar.

## AI Review

AI Review uses your GitHub Copilot models (including models you added to Copilot with your own key). Before the first review Allyproof tells you which provider will see your code. Code is only sent when you start a review; `allyproof.aiReview.auto` also starts one on save and is off by default. Allyproof has no telemetry.

The review instructions are the Allyproof Skill in `skills/allyproof/SKILL.md`.

## Use the Skill in your own agent

The AI Review and your own agent use the same Skill, [`skills/allyproof/SKILL.md`](skills/allyproof/SKILL.md).

- **GitHub Copilot in VS Code**: the extension contributes the Skill and the `a11y_check` tool, so chat and agent mode can use them without any setup. Ask for example "make this component accessible" or reference the tool with `#a11y_check`.
- **Claude Code, Cursor and other agents**: copy the `skills/allyproof` folder into your project's skills folder, for example `.claude/skills/allyproof/` (Claude Code) or `.agents/skills/allyproof/`, or your user-level skills folder. These agents use your own subscription.

`a11y_check` runs the Check on a file (`filePath`), on proposed code (`code` and `languageId`), or on proposed code for a file (`filePath` and `code`), so an agent can verify its fix before applying it. It returns the Findings with their line and the criteria that Need Review; the Skill calls it first and reviews only what the Check cannot decide. Outside VS Code with the extension the tool is not available, and the agent reviews only the semantic problems the Skill lists. Editors without the language model API (some VS Code forks) hide the AI Review, the Skill and the tool.

## Commands

All commands are in the Command Palette under **Allyproof**:

- Start AI Review
- Cancel AI Review

## Development

```sh
npm install         # on Node 24.15, the lowest supported runtime
npm run verify      # everything CI runs: lint, typecheck, unit tests, gate on source and bundle
npm run bundle      # dist/extension.mjs, dist/worker.mjs (the analysis worker) and one chunk per language engine
npm run test:unit
npm run test:gate   # Check precision/recall per language against ground truth
npm run test:bundle-gate  # the same gate against the packaged VSIX, unpacked without node_modules
npm run package     # allyproof-<version>.vsix
```

After an intended change in Check quality, store the new scores with `npm run test:gate -- --update` and commit the changed files in `test/ground-truth/baseline/`.

Press F5 to launch an Extension Development Host. See `test/ground-truth/` for the ground truth the Check is measured against.

## License

MIT
