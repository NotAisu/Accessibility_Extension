---
name: allyproof
description: Review frontend code (HTML, JSX/TSX, Vue, Svelte, Angular, Astro) for WCAG 2.2 AA problems that static linters cannot detect, and report each one with its line and success criterion.
---

# WCAG 2.2 AA semantic review

Review frontend source code for WCAG 2.2 A and AA problems that need understanding of meaning. A deterministic Check already reports missing attributes, missing labels and invalid ARIA.

## Run the Check first

Call the Check before and after each change (`check` via MCP `npx -y allyproof mcp`, `a11y_check` in Copilot, or `npx allyproof check <file> --format json`):

- Treat only Proven Check Findings as facts. Read rule docs with `explain_rule` (or `npx allyproof explain <ruleId>`) before fixing, apply deterministic `fix` edits verbatim, and re-run the Check to confirm the Finding is gone and no new Finding was added.
- Never add an ignore comment (`allyproof-ignore`) unless asked. Report Needs Review and Unproven matches as "needs a person" unless verified in a browser. A paused or failed Check (tool error or exit code 3) is an error, not a clean pass.

## Look for

Report only clear semantic failures:

- Non-descriptive image `alt` text such as `"image"` or `"photo.png"`, or decorative/informative mismatch (1.1.1).
- Visual-only structure: fake headings, fake lists, layout tables or data tables without headers (1.3.1).
- Sensory-only instructions relying on shape, position, color or sound (1.3.3, 1.4.1).
- Page titles, headings or form labels that do not describe their topic or purpose (2.4.2, 2.4.6, 3.3.2).
- Vague link or button text such as `"click here"`, `"more"`, or mismatched button label (2.4.4, 4.1.2).
- Visible label missing from the accessible name (2.5.3).
- Page or passage language mismatch with `lang` (3.1.1, 3.1.2).
- Missing or unhelpful form error messages (3.3.1, 3.3.3) and unannounced status updates (4.1.3).

## Verify Needs Review criteria in a browser

Only if you have a tool that opens the rendered page, measure text contrast (1.4.3) and target size (2.5.8) there and report only measured failures. With no such tool, as in a source-only review, leave these criteria to the developer and never estimate them.

## Do not report

- Color contrast and target size, unless a browser tool measured the failure.
- Static linter issues, style preferences, or anything not required by WCAG 2.2 A/AA.
- Speculative issues when context is missing; prefer an empty list over false positives.

## Report

For each problem give the 1-based line, the bare WCAG 2.2 criterion number (for example `2.4.4`, never a name or prefix), a one-sentence message, a one-sentence recommendation and your confidence between 0 and 1, in plain text.
