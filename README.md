# Allyproof – WCAG 2.2 Accessibility Checker

Allyproof checks your HTML, React, Vue, Svelte, Angular and Astro code against WCAG 2.2 A/AA while you write it, and can ask an AI model to review what a static Check cannot decide.

**No telemetry, no account.** The Check runs offline and free. Your code leaves your machine only when you start an AI Review, and only to the provider you chose.

> Pre-release. The coverage section below says exactly what is checked, what is listed as Needs Review and what is left to AI Review or to you.

Allyproof helps you find accessibility barriers early. It is not a WCAG conformance audit or certification: a static check of source code finds only some barriers, so test the rendered page with people and assistive technology before you claim conformance.

## Features

- **Check while you type**: Findings appear in the Problems panel for HTML, Vue, Svelte, JSX, TSX and Astro files and Angular component templates (`*.component.html` or an inline `template`). Each language runs its own accessibility linter. Only Proven rules report Findings: rules whose precision on labelled real code is at least 95 % at 95 % confidence; the others list their matches as likely failures under Needs Review. Every Finding names its WCAG 2.2 success criterion, and a hover explains why it is a problem and how to fix it, with links to the criterion. Your file is parsed, never executed, and your workspace's own lint config is never loaded.
- **Needs Review instead of silent passes**: criteria the Check cannot decide from source, such as text contrast or target size, are listed per file in the Findings tree, not guessed.
- **Static contrast**: where both colors are certain from literal values (inline styles, Tailwind's default palette and arbitrary values), a contrast below the WCAG 2.x ratio is reported with the measured ratio, under Needs Review until the rule is a Proven rule.
- **Quick fixes**: deterministic fixes for problems with exactly one right edit, such as removing `aria-hidden` from `<body>`. Fix on save is opt-in (`allyproof.check.fixOnSave`, off by default).
- **Findings tree**: an Activity Bar view grouped by file and criterion, filtered by Check, AI and Needs Review, plus a status bar summary of the current file. **Check Workspace** checks every supported file in the project.
- **Ignore and configure**: ignore one Finding with a comment (`<!-- allyproof-ignore image-alt -->`, in JSX `{/* allyproof-ignore … */}`), turn rules off or change their severity in `allyproof.rules`, and map your components to the native elements they render in `allyproof.components`. Ignoring a Finding and disabling its rule are offered in the lightbulb.
- **AI Review** (optional): reviews the current file or selection for semantic problems with GitHub Copilot (including models you added to Copilot with your own key) or a local model through LM Studio or Ollama. With Copilot it uses the cheapest capable model your plan offers: Claude Haiku 5.5, then GPT-6 Luna, GPT-5.6 Luna or GPT-5 mini. A Relevance Gate sends only regions with markup that changed since the last review. Its Findings appear as information marked "AI".
- **AI fixes**: every Finding has a "Fix with AI" quick fix, never the preferred one. The Check re-runs on the proposed edit and discards a fix that adds Findings; the fix is then shown as a diff you apply or discard.
- **Skill for your own agent**: the same review instructions the AI Review uses, plus the `a11y_check` tool, ready for Copilot chat and agent mode and as a file for Claude Code, Cursor and other agents.

## Supported languages and editors

| File | Language id |
| --- | --- |
| HTML | `html` |
| React (JSX, TSX) | `javascriptreact`, `typescriptreact` |
| Vue single-file components | `vue` |
| Svelte | `svelte` |
| Astro | `astro` |
| Angular component templates | `*.component.html`, inline `template` in `*.ts` |

Allyproof needs **VS Code 1.123** or later, or an editor built on it. Releases go to two registries:

- **VS Code**: the VS Code Marketplace.
- **Cursor** (3.x), **Windsurf** and **VSCodium**: Open VSX, the registry these editors install extensions from.

Editors without the language model API (some VS Code forks) run the Check and hide AI Review, the Skill and the tool. It runs in remote setups (SSH, WSL, dev containers, Codespaces) as well as locally.

## Coverage

The Check reports only what the source decides. Each language runs its own static accessibility linter; these are the WCAG 2.2 A/AA criteria they check:

| Language | Engine | Criteria |
| --- | --- | --- |
| HTML | axe-core (layout rules off), @html-eslint | 1.1.1, 1.2.1, 1.2.2, 1.3.1, 1.3.4, 1.3.5, 1.4.2, 1.4.4, 1.4.12, 2.1.1, 2.2.1, 2.2.2, 2.4.1, 2.4.2, 2.4.3, 2.4.4, 2.5.3, 3.1.1, 3.1.2, 3.3.2, 4.1.2 |
| JSX, TSX, Astro | eslint-plugin-jsx-a11y-x (Astro through eslint-plugin-astro) | 1.1.1, 1.2.2, 1.3.1, 1.3.5, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 3.1.1, 4.1.2 |
| Vue | eslint-plugin-vuejs-accessibility | 1.1.1, 1.2.2, 1.3.1, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 4.1.2 |
| Svelte | Svelte compiler a11y warnings | 1.1.1, 1.2.2, 1.3.1, 1.3.5, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 3.1.1, 4.1.2 |
| Angular | @angular-eslint/eslint-plugin-template | 1.1.1, 1.3.1, 2.1.1, 2.2.2, 2.4.3, 2.4.4, 2.4.6, 4.1.2 |

A listed criterion means the engine has rules for some of its failures, not that it decides the whole criterion: "every image has an `alt`" is checked, "the `alt` text describes the image" is not.

### Proven rules

A rule reports Findings only once it has proven its precision on real code: on independently labelled files (the W3C ACT Rules test cases, real pages and components from open-source projects, and real files with one known failure inserted), the 95 % lower confidence bound of its precision is at least 95 %. Until then its matches are listed as Needs Review, as likely failures to verify. A rule proves itself per language, because each language has its own engine. These rules are Proven rules today:

| Language | Rule | Criteria | Correct | Precision at least |
| --- | --- | --- | --- | --- |
| Angular | `@angular-eslint/template/alt-text` | 1.1.1 | 84 of 84 | 96.4 % |
| Angular | `@angular-eslint/template/elements-content` | 2.4.4, 4.1.2, 2.4.6, 1.3.1 | 159 of 159 | 98.1 % |
| Angular | `@angular-eslint/template/label-has-associated-control` | 1.3.1, 4.1.2 | 82 of 82 | 96.4 % |
| Angular | `@angular-eslint/template/no-positive-tabindex` | 2.4.3 | 80 of 80 | 96.3 % |
| Angular | `@angular-eslint/template/role-has-required-aria` | 4.1.2 | 80 of 80 | 96.3 % |
| Angular | `allyproof/autocomplete-valid` | 1.3.5 | 78 of 78 | 96.2 % |
| Astro | `allyproof/button-name` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/alt-text` | 1.1.1 | 60 of 60 | 95.1 % |
| Astro | `astro/jsx-a11y/anchor-has-content` | 2.4.4, 4.1.2 | 79 of 79 | 96.2 % |
| Astro | `astro/jsx-a11y/aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/aria-proptypes` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/aria-role` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/heading-has-content` | 2.4.6, 1.3.1 | 78 of 78 | 96.2 % |
| Astro | `astro/jsx-a11y/no-aria-hidden-on-focusable` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/role-has-required-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/role-supports-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| Astro | `astro/jsx-a11y/tabindex-no-positive` | 2.4.3 | 80 of 80 | 96.3 % |
| HTML | `aria-allowed-attr` | 4.1.2 | 78 of 78 | 96.2 % |
| HTML | `aria-hidden-body` | 1.3.1, 4.1.2 | 80 of 80 | 96.3 % |
| HTML | `aria-valid-attr` | 4.1.2 | 77 of 77 | 96.1 % |
| HTML | `autocomplete-valid` | 1.3.5 | 85 of 85 | 96.5 % |
| HTML | `button-name` | 4.1.2 | 74 of 74 | 96.0 % |
| HTML | `document-title` | 2.4.2 | 84 of 84 | 96.4 % |
| HTML | `html-has-lang` | 3.1.1 | 88 of 88 | 96.6 % |
| HTML | `html-lang-valid` | 3.1.1 | 85 of 85 | 96.5 % |
| HTML | `image-alt` | 1.1.1 | 205 of 205 | 98.5 % |
| HTML | `label` | 4.1.2 | 85 of 85 | 96.5 % |
| HTML | `link-name` | 2.4.4, 4.1.2 | 108 of 108 | 97.2 % |
| HTML | `valid-lang` | 3.1.2 | 80 of 80 | 96.3 % |
| JSX | `allyproof/button-name` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/alt-text` | 1.1.1 | 74 of 74 | 96.0 % |
| JSX | `jsx-a11y-x/anchor-has-content` | 2.4.4, 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/aria-proptypes` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/aria-role` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/autocomplete-valid` | 1.3.5 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/heading-has-content` | 2.4.6, 1.3.1 | 76 of 76 | 96.1 % |
| JSX | `jsx-a11y-x/label-has-associated-control` | 1.3.1, 4.1.2 | 76 of 76 | 96.1 % |
| JSX | `jsx-a11y-x/no-aria-hidden-on-focusable` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/role-has-required-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/role-supports-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| JSX | `jsx-a11y-x/tabindex-no-positive` | 2.4.3 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_consider_explicit_label` | 4.1.2, 2.4.4 | 119 of 119 | 97.5 % |
| Svelte | `svelte/a11y_incorrect_aria_attribute_type_token` | 4.1.2 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_missing_attribute` | 1.1.1, 2.1.1, 3.1.1, 4.1.2 | 81 of 81 | 96.3 % |
| Svelte | `svelte/a11y_missing_content` | 2.4.6, 1.3.1 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_positive_tabindex` | 2.4.3 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_role_has_required_aria_props` | 4.1.2 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_role_supports_aria_props_implicit` | 4.1.2 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_unknown_aria_attribute` | 4.1.2 | 80 of 80 | 96.3 % |
| Svelte | `svelte/a11y_unknown_role` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `allyproof/button-name` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/alt-text` | 1.1.1 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/anchor-has-content` | 2.4.4, 4.1.2 | 78 of 78 | 96.2 % |
| TSX | `jsx-a11y-x/aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/aria-proptypes` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/aria-role` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/autocomplete-valid` | 1.3.5 | 65 of 65 | 95.4 % |
| TSX | `jsx-a11y-x/heading-has-content` | 2.4.6, 1.3.1 | 62 of 62 | 95.2 % |
| TSX | `jsx-a11y-x/no-aria-hidden-on-focusable` | 4.1.2 | 79 of 79 | 96.2 % |
| TSX | `jsx-a11y-x/role-has-required-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/role-supports-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| TSX | `jsx-a11y-x/tabindex-no-positive` | 2.4.3 | 79 of 79 | 96.2 % |
| Vue | `vuejs-accessibility/alt-text` | 1.1.1 | 123 of 123 | 97.5 % |
| Vue | `vuejs-accessibility/anchor-has-content` | 2.4.4, 4.1.2 | 81 of 81 | 96.3 % |
| Vue | `vuejs-accessibility/aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| Vue | `vuejs-accessibility/aria-role` | 4.1.2 | 80 of 80 | 96.3 % |
| Vue | `vuejs-accessibility/heading-has-content` | 2.4.6, 1.3.1 | 79 of 79 | 96.2 % |
| Vue | `vuejs-accessibility/iframe-has-title` | 4.1.2 | 65 of 65 | 95.4 % |
| Vue | `vuejs-accessibility/label-has-for` | 1.3.1, 4.1.2 | 84 of 84 | 96.4 % |
| Vue | `vuejs-accessibility/no-aria-hidden-on-focusable` | 4.1.2 | 82 of 82 | 96.4 % |
| Vue | `vuejs-accessibility/role-has-required-aria-props` | 4.1.2 | 80 of 80 | 96.3 % |
| Vue | `vuejs-accessibility/tabindex-no-positive` | 2.4.3 | 80 of 80 | 96.3 % |

The evidence of every rule, proven or not, is in [`src/core/proof-status.json`](src/core/proof-status.json), and the labelled files are in [`test/ground-truth`](test/ground-truth).

Allyproof's own rules add what the engines miss, in every language and from literal values only (a bound value such as `:autocomplete="mode"` or `style={{ width: 16 }}` is never guessed):

| Criterion | Allyproof |
| --- | --- |
| 1.3.5 Identify Input Purpose (Vue, Angular) | `allyproof/autocomplete-valid`: an `autocomplete` value that is not an HTML autofill token sequence, such as `autocomplete="emal"`; the other languages' engines check 1.3.5 themselves |
| 1.4.3 Contrast (Minimum) | `allyproof/text-contrast`: text whose color and background are both certain from inline styles or Tailwind classes, on the element or a static ancestor, and fail 4.5:1 (3:1 for large text) |
| 1.4.11 Non-text Contrast | `allyproof/non-text-contrast`: a text field whose border and background are both certain and neither reaches 3:1 against its surroundings |
| 3.3.8 Accessible Authentication (Minimum) | `allyproof/password-autocomplete`: a password field with `autocomplete="off"` |
| 4.1.2 Name, Role, Value (JSX, TSX, Astro) | `allyproof/button-name`: a `<button>` with no visible text, accessible name attribute or potentially naming child |

### Needs Review

What only the rendered page can decide is listed per file as **Needs Review** in the Findings tree (not in the editor), with the reason:

| Criterion | When |
| --- | --- |
| 1.4.3 Contrast (Minimum) | The file renders text whose contrast static contrast could not decide, for example because a class comes from a stylesheet or a color is bound to an expression |
| 1.4.11 Non-text Contrast | A text field declares a border whose contrast is not certain from source |
| Any criterion of a rule that is not yet a Proven rule | The rule matched an element: a likely failure pointing at the element, to verify |
| 2.5.8 Target Size (Minimum) | The file renders controls. A control whose inline style or Tailwind classes (`w-4`, `size-5`, `w-[20px]`) declare less than 24×24 CSS px is listed as a likely failure pointing at the element |

### Not checked

The Check does not decide criteria that depend on meaning, behaviour or other pages, such as meaningful alt text (1.1.1), link purpose (2.4.4), focus visible (2.4.7), focus not obscured (2.4.11), dragging movements (2.5.7), consistent help (3.2.6), redundant entry (3.3.7) or status messages (4.1.3). The semantic ones are what AI Review is for; the rest need testing in the browser.

### AI Review

AI Review sees only source code. It looks for semantic problems the Check cannot detect, such as alt text that does not describe its image, vague link text or a missing label for a custom control. Its Findings are probable, not certain, and are reported as information marked "AI". It never reports contrast (1.4.3, 1.4.11) or target size (2.5.8): from source those would be guesses, so they stay with the Check and Needs Review.

## Privacy

- **No telemetry, no account.** Allyproof collects nothing and sends nothing about you or your usage.
- The Check runs locally and offline. Your project's code and lint config are never executed.
- AI Review sends code only when you start it (`allyproof.aiReview.auto` also starts it on save and is off by default). Before the first review Allyproof tells you which provider will see your code. With a local model your code stays on your machine.
- In an untrusted workspace AI Review uses only GitHub Copilot, so a repository cannot redirect your code to another endpoint through workspace settings.
- **Allyproof: Report Issue** opens a prefilled issue with your environment and no code.

## Use the Skill and MCP server in your own agent

The AI Review and your own agent use the same Skill, [`skills/allyproof/SKILL.md`](skills/allyproof/SKILL.md), and the same deterministic Check.

For coding agents with browser automation tools (Playwright, preview tools or DevTools), this repository also includes an optional rendered browser audit Skill, [`skills/allyproof-browser-audit/SKILL.md`](skills/allyproof-browser-audit/SKILL.md) (`allyproof-browser-audit`). It runs the static Check first and fixes Proven Findings before auditing the running app, separating deterministic DOM/style measurements (1.4.3/1.4.11 contrast, 2.5.8 target size, 2.4.7/2.4.11 focus visible and not obscured, 1.4.10 reflow at 320px, computed accessibility tree, modal focus traps and live regions) from visual AI judgment. Copy `skills/allyproof-browser-audit` alongside `skills/allyproof` in your agent's skills folder; Claude Code installs both with the plugin.

- **MCP server (`npx allyproof mcp`)**: runs over stdio with no network requests, no AI and no file writes. It exposes `check` (files, folders with summary + `limit`, or proposed `code`), `explain_rule`, `list_rules`, each rule's docs as `allyproof://rules/<ruleId>` and the Skill as the `allyproof_review` prompt. Paths stay inside the client's MCP roots (or the project root when the client sends none); symlinks leaving a root are rejected.
- **Claude Code**: this repository is a Claude Code plugin (`.claude-plugin/plugin.json`, `.mcp.json` and `skills/allyproof/SKILL.md`) that installs the pinned MCP server and the Skill together. Or copy `skills/allyproof` into `.claude/skills/allyproof/`.
- **Codex**: add the MCP server in `~/.codex/config.toml` (or `.codex/config.toml`) and copy `skills/allyproof` into `.agents/skills/allyproof/`:
  ```toml
  [mcp_servers.allyproof]
  command = "npx"
  args = ["-y", "allyproof@0.1.3", "mcp"]
  ```
- **Cursor**: add to `.cursor/mcp.json`:
  ```json
  {
    "mcpServers": {
      "allyproof": {
        "command": "npx",
        "args": ["-y", "allyproof@0.1.3", "mcp"]
      }
    }
  }
  ```
- **Zed**: add to `settings.json`:
  ```json
  {
    "context_servers": {
      "allyproof": {
        "command": "npx",
        "args": ["-y", "allyproof@0.1.3", "mcp"]
      }
    }
  }
  ```
- **VS Code**: the extension contributes the Skill and `a11y_check` automatically for Copilot chat and agent mode. To connect the MCP server directly (for any agent in VS Code), add to `.vscode/mcp.json`:
  ```json
  {
    "servers": {
      "allyproof": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "allyproof@0.1.3", "mcp"]
      }
    }
  }
  ```
- **Your repository**: **Allyproof: Add Skill to Repository** writes the Skill to `.github/skills/allyproof/SKILL.md` (and optionally `.claude/skills` and `.agents/skills`), carrying the extension version in its `metadata`; an existing Skill file is only replaced after you confirm.

`a11y_check` (in VS Code) and `check` (over MCP) run the Check on files or proposed code so an agent can verify its fix before writing it. Outside MCP and VS Code, the agent runs the same Check from the command line (`allyproof check <file> --format json`, or `--stdin --stdin-filename <file>`).

## Block inaccessible commits

The command line runs the editor's Check, with the same engines, the rule settings and Component Mapping from `.vscode/settings.json`, and the same ignore comments. It needs Node 24.15, makes no network requests, runs no AI and never executes your code.

```sh
npx allyproof check                    # the repository, or the paths you name
npx allyproof check --staged           # what is about to be committed, from Git's index
npx allyproof check --changed origin/main --format sarif > allyproof.sarif
npx allyproof baseline                 # accept today's Findings; only new ones block
npx allyproof explain image-alt        # what a rule checks, why, how to fix it, and its proof
npx allyproof rules --format json      # every rule, its criteria and its proof status
```

Only Findings block; Needs Review is listed and never blocks. `--fail-on error|warning|information` sets the lowest severity that blocks (`warning`, so every Finding, by default). Exit codes: **0** no blocking Findings, **1** blocking Findings, **2** a usage or configuration error, **3** a file could not be checked (a parse error, an engine crash or a deadline), so a commit never passes with a file left unchecked. `--format json` follows the JSON Schema in [`schema/check-result.v1.json`](schema/check-result.v1.json) and carries each Finding's fix edits and proof status. The baseline (`.allyproof-baseline.json`) records each Finding by rule, file and start tag, so it survives lines moving, and the summary counts how many baselined Findings were fixed. Git's own `--no-verify` is the only way to skip a hook.

- **Set it up**: **Allyproof: Set Up Commit Check** adds the check to lefthook, to lint-staged under Husky, to Husky's `pre-commit` hook or to the pre-commit framework (as a local hook), or writes a plain Git hook, and can add a GitHub Actions workflow. It shows every file it will create or change and writes only after you confirm; existing entries are kept.
- **GitHub Actions**: the `NotAisu/Accessibility_Extension` action checks the files a pull request changes, fails the job on blocking Findings, and uploads SARIF, so Findings appear as code scanning alerts on the changed lines. Check out with `fetch-depth: 0`, grant `security-events: write`, and make the job a required status check to enforce it. Inputs: `base`, `paths`, `baseline`, `fail-on`, `upload-sarif`.
- **Other CI**: run `npx allyproof check --changed <base>` and use the exit code; SARIF and JSON work with any code scanning or report tool.

## Commands

All commands are in the Command Palette under **Allyproof**:

- Check Workspace: checks every supported file that `files.exclude` and `.gitignore` leave and lists the Findings in the Findings tree; files that are not open get no diagnostics in the editor. Running it again re-checks only the files that changed.
- Filter Findings
- Start AI Review, Cancel AI Review, Clear AI Review Cache
- Add Skill to Repository
- Set Up Commit Check
- Show Log
- Report Issue

## Feedback

Found a false positive, a missed problem or a bug? [Report Issue](https://github.com/NotAisu/Accessibility_Extension/issues), or run **Allyproof: Report Issue** to open one prefilled with your environment.

## Development

```sh
npm install         # on Node 24.15, the lowest supported runtime
npm run verify      # everything CI runs: lint, typecheck, unit tests, gate on source and bundle
npm run bundle      # dist/extension.mjs, dist/worker.mjs (the analysis worker) and one chunk per language engine
npm run test:unit
npm run test:gate   # Check precision/recall per language against ground truth
npm run test:bundle-gate  # the same gate against the packaged VSIX, unpacked without node_modules
npm run package     # allyproof-<version>.vsix
npm run icon        # media/icon.png from media/icon.svg
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

### Agent eval

A second local evaluation, also never in CI and not part of `npm run verify`, measures whether a coding agent with the Allyproof MCP server and the Skill fixes accessibility problems. Each task is a whole file from the `field` or `injection` ground truth whose labelled Findings the Check reports, given to the agent with "Fix the accessibility problems in this file" in an empty folder holding only that file, the Skill Variant as the project's Skill and `allyproof mcp` as its only MCP server (no shell, no web). The agent ends with the Findings it claims fixed, and the Check scores every run:

- fixed: labelled Findings the Check no longer reports;
- added: Findings reported after but not before; a run with any fails;
- integrity: the file still parses and keeps the words of its text and its interactive and embedded elements (an element may change its tag, a clickable `div` may become a `button`); deleting content to remove a Finding fails the run;
- honesty: every claimed fix is a Finding the Check reported before and no longer reports; a false claim fails the run;
- cost: tool calls, tokens and wall time per fixed Finding.

Findings are matched by rule, since a fix moves lines. Only passed runs count their fixes. The Skill Variant with the most fixes over all agents and models wins, fewer tokens per fix breaking a tie.

```sh
npm run bundle                                  # the agent's MCP server and the scorer run the bundled command line
npm run eval:agent -- --dry-run --limit 1       # list the tasks, no agent runs
npm run eval:agent -- --claude sonnet --limit 1 # Claude Code (claude -p, signed in) with each Skill Variant
npm run eval:agent -- --help
```

It costs tokens: every run is one agent session per task, Skill Variant and model. Results are printed and written per agent, model and Skill Variant to `out/agent-eval/<agent>--<model>--<variant>.json`, with the summary and winner in `out/agent-eval/report.json`. Claude Code is the first agent; another (Codex, a local model in an MCP-capable harness) is an `AgentPort` in `test/agent-eval/`.

Press F5 to launch an Extension Development Host. See `test/ground-truth/` for the ground truth the Check is measured against.

## License

MIT
