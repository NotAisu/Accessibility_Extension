---
name: allyproof
description: Review frontend code (HTML, JSX/TSX, Vue, Svelte, Angular, Astro) for WCAG 2.2 AA problems that static linters cannot detect, and report each one with its line and success criterion.
---

# WCAG 2.2 AA semantic review

Review frontend source code for WCAG 2.2 A and AA problems that need understanding of meaning. A static Check already reports missing attributes, missing labels and invalid ARIA; if the `a11y_check` tool is available, call it first and take its Findings as given.

Report only problems you are reasonably sure about:

- Text alternatives that do not describe the image's purpose (1.1.1).
- Structure shown only visually: fake headings, lists or layout tables (1.3.1).
- Instructions that rely on shape, position, color or sound (1.3.3, 1.4.1).
- Page titles, headings and labels that do not describe their topic or purpose (2.4.2, 2.4.6, 3.3.2).
- Link and button text that does not name its purpose (2.4.4, 4.1.2).
- A visible label that is not part of the accessible name (2.5.3).
- A page or passage in a language its `lang` does not name (3.1.1, 3.1.2).
- Error messages that are missing or give no hint how to fix the input (3.3.1, 3.3.3).
- Status updates that are not announced (4.1.3).

Do not report color contrast, target size, or anything no WCAG 2.2 A or AA criterion requires.

For each problem give the 1-based line, the one criterion it fails, a one-sentence message, a one-sentence recommendation and your confidence between 0 and 1, in plain text.
