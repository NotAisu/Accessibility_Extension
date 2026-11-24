# Changelog

Pre-releases use odd minor versions, stable releases even ones.

## 0.2.1

- Fixed Official MCP Registry namespace casing (`io.github.NotAisu/allyproof`) for GitHub OIDC publishing.
- Added ASCII crest banner to `allyproof --help` and TTY-aware framing/color to `allyproof check` (preserving ANSI-free output for CI, pipes, `--format json`/`sarif`, and `NO_COLOR`).
- Redesigned the static GitHub Pages documentation site (`site/index.html`).

## 0.2.0

First stable release of Allyproof – WCAG 2.2 Accessibility Checker.

### Expanded Proven rules coverage

- Expanded Proven rules from 23 to **73** across HTML, JSX, TSX, Vue, Svelte, Angular and Astro (6,092/6,092 = 100% measured precision, >= 95% Wilson lower bound at 95% confidence per ADR 0005).
- Fixed Astro `<label><slot /></label>` false positive.
- Added automatic API key redaction in ground-truth injection generation (`test/ground-truth/generate-injection.ts`).

### Agent ecosystem and discoverability

- Added Official MCP Registry descriptor (`server.json`, `io.github.notaisu/allyproof`), npm `mcpName` ownership metadata, and automated GitHub OIDC publishing in the release workflow.
- Added Cursor plugin bundle (`.cursor-plugin/plugin.json` and `.cursor/rules/allyproof.mdc`), one-click VS Code & Cursor MCP install badges, and local stdio MCP setup docs for Claude Code, Codex, Cursor, Windsurf, Cline, Roo Code, Zed, VS Code and Gemini CLI.
- Added optional rendered browser WCAG 2.2 AA audit Skill (`skills/allyproof-browser-audit/SKILL.md`) for agents with Playwright, DevTools or preview tools, and sharpened the core Skill trigger description in `skills/allyproof/SKILL.md`.
- Added static zero-JS, zero-tracker GitHub Pages documentation (`site/index.html`), machine-readable `site/llms.txt`, and `.github/workflows/pages.yml`.
- Added npm discovery metadata (`homepage`, `keywords`) and strict zero-leak packaging contract tests for VSIX and npm tarballs.

### Local AI Review reliability

- Added local model tool-calling fallback (`src/review/local-model.ts`) for OpenAI-compatible servers (LM Studio / Ollama) that do not support tool calls, plus stratified benchmark sampling.

## 0.1.3 (pre-release)

### MCP server and agent plugin

- `allyproof mcp` starts a local, read-only stdio MCP server for coding agents: `check` (files, folders with per-file/rule/criterion summary and `limit`, or proposed `code`), `explain_rule`, `list_rules`, every rule's docs as `allyproof://rules/<ruleId>`, and the Allyproof Skill as the `allyproof_review` prompt.
- Paths stay inside the client's MCP roots (with `roots/list_changed` support) or the project root when none are declared; symlinks leaving a root are rejected, including `.vscode/settings.json`.
- Claude Code plugin (`.claude-plugin/plugin.json`, `.mcp.json` and `skills/allyproof/SKILL.md`), updated Skill for the verified check → fix → re-check loop, and README setup for Claude Code, Codex, Cursor, Zed and VS Code MCP.

### Command line, GitHub Action and reliability

- `allyproof --version` prints the package version; pre-releases publish the command line to npm under the `next` tag and attach the CLI tarball to the GitHub release.
- The GitHub Action installs the command line from npm instead of building from source.
- Security dependency update (`minimatch` 11.0.8 override) and stricter ground-truth gate validation against conflicting duplicate evidence labels.

## 0.1.1 (pre-release)

First pre-release of Allyproof – WCAG 2.2 Accessibility Checker. (0.1.0 was tagged but never published.)

### Proven rules

- A rule reports Findings only when it is a Proven rule in that language: at least 95 % precision at 95 % confidence on the W3C ACT Rules and on labelled real code from open-source projects. Every other match is listed as Needs Review and never blocks. The README lists the Proven rules; each Finding's hover shows its evidence.

### Command line and commit check

- `allyproof check`, `baseline`, `explain` and `rules`, with text, JSON and SARIF output, `--staged`, `--changed` and a baseline that only blocks new Findings.
- Set Up Commit Check adds the check to lefthook, Husky, lint-staged, the pre-commit framework or a plain Git hook, and optionally a GitHub workflow.
- A GitHub Action that uploads the results to code scanning.

### Check

- Checks HTML, JSX, TSX, Vue, Svelte, Astro and Angular templates (external and inline) against WCAG 2.2 A/AA while you type, each with its own static accessibility linter. Files are parsed, never executed; the workspace's lint config is never loaded.
- Own rules for WCAG 2.2 gaps: valid `autocomplete` (Vue, Angular), password fields with `autocomplete="off"`, and static text and non-text contrast from literal colors.
- Needs Review lists, per file, what the Check cannot decide from source (contrast, target size), with statically declared targets below 24×24 CSS px as likely failures.
- Learn hover with explanation, framework examples and WCAG links; deterministic quick fixes and opt-in fix on save.
- Ignore comments, per-rule severity and disable settings, and Component Mapping for your own components.
- Runs in a separate analysis worker with a deadline, so a slow or broken engine never freezes the editor; large files are checked on save.
- Check Workspace for the whole project.

### AI Review

- Optional review of the current file or selection with GitHub Copilot (including your own keys added to Copilot) or a local model through LM Studio or Ollama.
- Relevance Gate: only changed regions with markup are sent; unchanged regions come from a cache.
- Fix with AI: fixes are re-checked and shown as a diff before you apply them.

### Skill

- The Allyproof Skill and the `a11y_check` tool for Copilot chat and agent mode, and Add Skill to Repository for Copilot code review and other agents.

### UI and trust

- Findings tree with filters, status bar summary, walkthrough, log and Report Issue.
- No telemetry, no account. In untrusted workspaces AI Review uses only Copilot.
