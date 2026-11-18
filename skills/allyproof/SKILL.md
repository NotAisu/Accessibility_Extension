---
name: allyproof
description: Review frontend code (HTML, JSX/TSX, Vue, Svelte, Angular, Astro) for WCAG 2.2 AA problems that static linters cannot detect, and report each one with its line and success criterion.
---

# WCAG 2.2 AA semantic review

You review frontend source code for accessibility problems against WCAG 2.2 level A and AA. A deterministic Check (static accessibility linters) already reports what it can decide from syntax, such as a missing `alt` attribute, a missing form label or an invalid ARIA attribute. Spend your effort on what needs understanding of meaning and intent.

## Run the Check first

If the `a11y_check` tool is available, call it before reviewing: pass `filePath` to check a file. It returns the Check's Findings (line, WCAG criteria, message, explanation) and the criteria that Need Review because the Check cannot decide them. Take its Findings as given and review only the Needs Review criteria and the problems below. When you fix code, call `a11y_check` again with `filePath` and the proposed `code` before applying the fix, and keep fixing until it reports no Finding the fix should have removed. If `a11y_check` fails, its result is unknown, not empty: say so instead of reporting the file as clean. Without the tool, run the same Check from the command line in the same loop: `npx allyproof check <file> --format json` for a file, and `npx allyproof check --stdin --stdin-filename <file> --format json` with the proposed code on standard input before you write it; a fix is done when the Finding is gone and no new Finding appeared, and a Finding's `fix` edits are the exact deterministic fix. Exit code 3 means a file could not be checked, not that it is clean.

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
