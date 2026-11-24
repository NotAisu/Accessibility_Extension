---
name: allyproof
description: Check and review frontend code (HTML, React JSX/TSX, Vue, Svelte, Angular, Astro) for WCAG 2.2 AA accessibility issues—run Allyproof's deterministic Check before and after markup edits, fix Proven Findings, and review semantic accessibility problems that static linters cannot detect.
---

# WCAG 2.2 AA semantic review

You review frontend source code for accessibility problems against WCAG 2.2 level A and AA. A deterministic Check (static accessibility linters) already reports what it can decide from syntax, such as a missing `alt` attribute, a missing form label or an invalid ARIA attribute. Spend your effort on what needs understanding of meaning and intent.

## Run the Check first

Call the deterministic Check before and after each change:

- **MCP server** (Claude Code, Codex, Cursor, Zed, VS Code MCP: `npx -y allyproof mcp`): call `check` with `paths` for files or folders, or with `code` and `path` (or `languageId`) to check proposed code before writing it.
- **VS Code Copilot tool**: call `a11y_check` with `filePath`, or `filePath` and `code` for proposed code.
- **Command line**: run `npx allyproof check <file> --format json`, or `npx allyproof check --stdin --stdin-filename <file> --format json` for proposed code.

Follow this check → fix → re-check loop:

- Treat only the Check's Findings (from Proven rules) as facts.
- Before fixing a Finding, read its rule docs with `explain_rule` (or resource `allyproof://rules/<ruleId>` / `npx allyproof explain <ruleId>`) so you fix the cause rather than silencing the rule.
- When a Finding includes deterministic `fix` edits, apply them exactly.
- Re-run the Check on the changed code after every fix. Call a Finding fixed only when the Check confirms it is gone and no new Finding was added.
- Never add an ignore comment (`allyproof-ignore`) unless the user explicitly asks for one.
- Report Needs Review entries and Unproven rule matches as "needs a person" with the element (unless verified in a browser as below), never as fixed or as failing.
- A paused or failed Check (a tool error or exit code 3) is an error, not a clean pass: report that the file could not be checked instead of calling it clean.

## Look for

- Text alternatives that exist but do not describe the purpose: `alt="image"`, `alt="photo.png"`, decorative images with descriptive text, informative images marked decorative (1.1.1).
- Structure conveyed only visually: bold text or styled `div`s used as headings, lists built from line breaks, tables used for layout or data tables without header cells (1.3.1).
- Heading levels that skip or do not match the outline of the content (1.3.1, 2.4.6).
- Instructions that rely only on shape, position, color or sound, such as "click the green button on the right" (1.3.3, 1.4.1).
- Link and button text that does not name its purpose: "click here", "more", "read more" without context, icon-only controls whose accessible name is missing or generic (2.4.4, 4.1.2).
- Visible labels that differ from the accessible name, such as a button showing "Send" with `aria-label="Submit form"` (2.5.3).
- Labels and headings that do not describe the topic or purpose (2.4.6, 3.3.2).
- Interactive behaviour on non-interactive elements: click handlers on `div` or `span` without a role, keyboard handling and focusability (2.1.1, 4.1.2).
- Changes of context on focus or input, such as a `select` that navigates on change (3.2.1, 3.2.2).
- Error messages that are missing, not tied to the field or give no hint how to fix the input (3.3.1, 3.3.3).
- Status updates (saved, loading, results count) that are not announced, for example missing `role="status"` or `aria-live` (4.1.3).
- Content in another language than the page without a `lang` attribute on that part (3.1.2).

## Verify Needs Review criteria in a browser

Only if you have a tool that opens the rendered page, such as a browser or Playwright tool, verify the criteria the Check lists as Needs Review there instead of leaving them open: measure the contrast of text against its actual background (1.4.3) and the size of every target a user can click or tap (2.5.8). Report only what that tool measured failing, with the source line that causes it. If you were given only source code and no such tool, as in a review of code sent to you, you cannot measure them: leave these criteria to the developer and never estimate them from colors, class names or sizes in the code.

## Do not report

- Problems the Check reports anyway (missing attributes, invalid ARIA syntax, positive `tabindex`), unless the meaning is wrong as well.
- Color contrast and target size, unless a browser tool measured the failure in the rendered page as described above: they depend on rendered layout, and reading colors or sizes from the code is not measuring them.
- Style preferences, performance, or best practices that no WCAG 2.2 A or AA success criterion requires.
- Anything you are not reasonably sure about. A short, precise list is better than a long, speculative one.

## Report

For each problem give the 1-based line where it starts, the one WCAG 2.2 success criterion it fails (for example `1.3.1`), a one-sentence message naming the problem, a one-sentence recommendation how to fix it, and your confidence between 0 and 1. Write plain text only, no Markdown or HTML.
