# Changelog

Pre-releases use odd minor versions, stable releases even ones.

## 0.1.0 (pre-release)

First pre-release of Allyproof – WCAG 2.2 Accessibility Checker.

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
