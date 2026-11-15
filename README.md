# Allyproof – WCAG 2.2 Accessibility Checker

Allyproof checks your frontend code against WCAG 2.2 A/AA while you work and can ask an AI model to review it.

> Early preview. Analysis currently runs axe-core on a static parse of the file; results for HTML are the most reliable.

## Features

- **Check**: Findings appear in the Problems panel when you open or save an HTML, Vue, Svelte, JSX or TSX file. Your file is parsed, never executed.
- **AI Review**: `Allyproof: Start AI Review` asks GitHub Copilot to look for semantic problems the Check cannot detect. Its Findings appear as information marked "AI"; progress and the result are shown in the status bar.

## AI Review

AI Review uses your GitHub Copilot models (including models you added to Copilot with your own key). Before the first review Allyproof tells you which provider will see your code. Code is only sent when you start a review; `allyproof.aiReview.auto` also starts one on save and is off by default. Allyproof has no telemetry.

The review instructions are the Allyproof Skill in `skills/allyproof/SKILL.md`.

## Commands

All commands are in the Command Palette under **Allyproof**:

- Start AI Review
- Cancel AI Review

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
