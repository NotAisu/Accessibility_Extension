---
name: allyproof
description: Review frontend code (HTML, JSX/TSX, Vue, Svelte, Angular, Astro) for WCAG 2.2 AA problems that static linters cannot detect, and report each one with its line and success criterion.
---

# WCAG 2.2 AA semantic review

Review frontend source code for WCAG 2.2 A and AA semantic failures. A deterministic Check already covers syntax and missing attributes; focus strictly on meaning and intent, and return an empty list when the code has no clear semantic failure.

## Run the Check first

Call the deterministic Check before and after each change:

- **MCP server** (`npx -y allyproof mcp`): call `check` with `paths` or with `code` and `path`/`languageId`.
- **VS Code Copilot tool**: call `a11y_check` with `filePath`, or `filePath` and `code`.
- **Command line**: run `npx allyproof check <file> --format json` (or `--stdin --stdin-filename <file>`).

Follow the check → fix → re-check loop: treat only Proven Check Findings as facts, read `explain_rule` before fixing, apply deterministic `fix` edits verbatim, and re-run the Check to confirm the Finding is gone and no new Finding was added. Never add an ignore comment (`allyproof-ignore`) unless asked. Report Needs Review and Unproven matches as "needs a person" unless verified in a browser. A paused or failed Check (tool error or exit code 3) is an error, not a clean pass.

## Semantic failures to report

Only report a Finding when the code clearly violates one of these criteria:

- `1.1.1`: `alt` text is a placeholder, filename or generic word (`"image"`, `"logo.png"`, `"picture"`) instead of describing the image's purpose, or an informative image has empty `alt=""`.
- `1.3.1`: Visual-only headings (styled `<div>`/`<b>`/`<span>` acting as a heading), fake lists, layout tables, or data tables missing header cells.
- `1.3.3` / `1.4.1`: Instructions relying only on shape, position, color or sound.
- `2.4.2`: `<title>` is generic or does not describe the page topic (`"Home"`, `"Untitled"`, filename).
- `2.4.4`: Link text is vague or does not describe its destination (`"click here"`, `"read more"`, `"link"`, raw URL) or contradicts its target.
- `2.4.6`: Heading or form label is ambiguous, generic or does not describe the section or field.
- `2.5.3`: Visible label text is not contained in the element's `aria-label` or accessible name.
- `3.1.1`: Document `lang` attribute does not match the primary language of the page content.
- `3.1.2`: A phrase or passage in a different language than the page lacks a `lang` attribute.
- `3.3.1` / `3.3.2` / `3.3.3`: Form field label is unclear or mismatched, or error feedback is missing/unhelpful.
- `4.1.2`: Button or control accessible name contradicts or fails to describe its action, or clickable `div`/`span` lacks role and keyboard support.
- `4.1.3`: Dynamic status updates (saved, loading, result counts) lack `role="status"` or `aria-live`.

## Verify Needs Review criteria in a browser

Only if you have a tool that opens the rendered page, verify Needs Review criteria there: measure text contrast (1.4.3) and target size (2.5.8) and report only measured failures. If you have no such tool, as in a source-only review, leave these criteria to the developer and never estimate them from colors, class names or sizes.

## Do not report

- Color contrast and target size, unless a browser tool measured the failure.
- Clean, descriptive labels, headings, links, buttons or `alt` texts: if the text clearly states the purpose, do not report it.
- Problems caused only by missing surrounding page context (for example a component snippet without `<html>`, `<title>` or `<main>`).
- Problems the Check reports anyway (missing `alt`, invalid ARIA syntax), style preferences, or best practices outside WCAG 2.2 A/AA.
- Uncertain or speculative Findings. When in doubt, omit it.

## Report

For each confirmed problem report:
- `line`: 1-based line number where the element starts.
- `criterion`: ONLY the bare WCAG 2.2 number (for example `2.4.4`, never `"WCAG 2.4.4"` or a title).
- `message`: one plain-text sentence naming the failure.
- `recommendation`: one plain-text sentence explaining the fix.
- `confidence`: number between 0 and 1.
