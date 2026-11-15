# Allyproof – WCAG 2.2 Accessibility Checker

Allyproof checks your frontend code against WCAG 2.2 A/AA while you work and can ask an AI model to review it.

> Early preview. Analysis currently runs axe-core on a static parse of the file; results for HTML are the most reliable.

## Features

- **Check**: Findings appear in the Problems panel when you open or save an HTML, Vue, Svelte, JSX, TSX or Astro file, or an Angular component template (`*.component.html` or an inline `template`). Your file is parsed, never executed.
- **AI Review**: `Allyproof: Start AI Review` asks GitHub Copilot to look for semantic problems the Check cannot detect. Its Findings appear as information marked "AI"; progress and the result are shown in the status bar.

## Coverage

The Check reports only what the source decides. Each language runs its own static accessibility linter; these are the WCAG 2.2 A/AA criteria they report Findings for:

| Language | Engine | Criteria |
| --- | --- | --- |
| HTML | axe-core (layout rules off), @html-eslint | 1.1.1, 1.2.1, 1.2.2, 1.3.1, 1.3.4, 1.3.5, 1.4.2, 1.4.4, 1.4.12, 2.1.1, 2.2.1, 2.2.2, 2.4.1, 2.4.2, 2.4.3, 2.4.4, 2.5.3, 3.1.1, 3.1.2, 3.3.2, 4.1.2 |
| JSX, TSX, Astro | eslint-plugin-jsx-a11y-x (Astro through eslint-plugin-astro) | 1.1.1, 1.2.2, 1.3.1, 1.3.5, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 3.1.1, 4.1.2 |
| Vue | eslint-plugin-vuejs-accessibility | 1.1.1, 1.2.2, 1.3.1, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 4.1.2 |
| Svelte | Svelte compiler a11y warnings | 1.1.1, 1.2.2, 1.3.1, 1.3.5, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 3.1.1, 4.1.2 |
| Angular | @angular-eslint/eslint-plugin-template | 1.1.1, 1.3.1, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 4.1.2 |

None of them checks a criterion new in WCAG 2.2. Allyproof's own rules cover those that are statically checkable, in every language, from literal values only (a bound value such as `:autocomplete="mode"` or `style={{ width: 16 }}` is never guessed):

| Criterion | Upstream | Allyproof |
| --- | --- | --- |
| 2.4.11 Focus Not Obscured (Minimum) | – | Not decidable from source: depends on rendered layout and sticky content |
| 2.5.7 Dragging Movements | – | Not decidable from source: whether a single-pointer alternative exists is behaviour |
| 2.5.8 Target Size (Minimum) | axe-core's rule needs layout, so it is off | A control whose inline style or Tailwind classes (`w-4`, `size-5`, `w-[20px]`) declare less than 24×24 CSS px is listed as a likely failure in Needs Review, pointing at the element; every other control leaves 2.5.8 in Needs Review |
| 3.2.6 Consistent Help | – | Not decidable from one file: compares pages |
| 3.3.7 Redundant Entry | – | Not decidable from source: depends on the process |
| 3.3.8 Accessible Authentication (Minimum) | – | `allyproof/password-autocomplete`: a password field with `autocomplete="off"` |

Contrast (1.4.3) and target size are listed as Needs Review for any file that renders text or controls. Criteria the Check cannot decide, such as meaningful alt text or link purpose, are what AI Review is for. Vue and Angular have no upstream rule for 1.3.5 Identify Input Purpose.

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

### AI benchmark

The Skill that ships is chosen by a local benchmark that never runs in CI, because it sends code to models and costs tokens. It reviews the AccessGuru semantic subset (fetched at bench time) and the W3C ACT cases that need judgment, wrapped into Vue and Svelte components and marked synthetic, with every Skill Variant (the shipped `skills/allyproof/SKILL.md` and each `test/bench/variants/*.md`) on every model, and reports recall, precision and tokens per Variant and model.

```sh
# Local models: load them in LM Studio, or pull them with Ollama
npm run bench -- --local qwen2.5-coder-7b-instruct --local llama3.1:8b@http://localhost:11434/v1
# Add Copilot: opens a VS Code window with its own profile; sign in to Copilot there on the first run
npm run bench -- --local qwen2.5-coder-7b-instruct --copilot
npm run bench -- --help
```

The winner has the highest recall over all models among the Variants with a precision of at least 0.8; fewer tokens break a tie. The benchmark prints the command that ships it (`cp test/bench/variants/<name>.md skills/allyproof/SKILL.md`), and writes the full results to `out/bench/results.json` for the PR that ships it.

Press F5 to launch an Extension Development Host. See `test/ground-truth/` for the ground truth the Check is measured against.

## License

MIT
