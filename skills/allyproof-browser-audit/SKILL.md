---
name: allyproof-browser-audit
description: Run a two-stage WCAG 2.2 AA audit on a running web app: fix Allyproof static Check Findings first, then separate deterministic browser DOM/style measurements from visual AI judgment.
---

# WCAG 2.2 AA rendered browser audit

You audit a running web application against WCAG 2.2 level A and AA using Allyproof's deterministic Check together with browser automation tools (Playwright, browser preview or DevTools). Follow a strict two-stage workflow and never report visual guesses as confirmed failures.

## Stage 1: Static Check first

Run Allyproof's deterministic static Check and fix all Proven Findings before opening a browser:

- **MCP server** (`npx -y allyproof mcp`): call `check` with `paths` for files or folders, or with `code` and `path` (or `languageId`) to check proposed edits before writing them.
- **VS Code Copilot tool**: call `a11y_check` with `filePath`, or `filePath` and `code` for proposed edits.
- **Command line**: run `npx allyproof check <paths> --format json`, or `npx allyproof check --stdin --stdin-filename <file> --format json` for proposed edits.

Follow the check → fix → re-check loop:

- Treat only Findings from Proven rules as confirmed static failures.
- Read each Finding's rule docs with `explain_rule` (or `allyproof://rules/<ruleId>` / `npx allyproof explain <ruleId>`) before editing so you fix the cause.
- Apply deterministic `fix` edits verbatim when provided.
- Re-run the Check after every edit. Call a Finding fixed only when the Check confirms it is gone and no new Finding was added.
- Never add an ignore comment (`allyproof-ignore`) unless the user explicitly asks for one.
- A paused or failed Check (tool error or exit code 3) is an error, not a clean pass: stop and report that the file could not be checked.

Carry the Check's Needs Review entries and Unproven rule matches into Stage 2 if a browser measurement can decide them; otherwise report them as "needs a person".

If no browser automation tool is available or the app cannot be started, stop after Stage 1 and report that rendered checks could not run. Never estimate contrast, target size, focus visibility or reflow from source code alone.

## Stage 2: Rendered browser audit

Open the running app in your browser tool and cover the relevant routes, interactive states (default, hover, focus, error, open dialog or menu) and color schemes (light and dark mode when supported). Keep deterministic measurements strictly separate from visual AI judgment.

### Deterministic browser measurements

Compute these directly from the live DOM, computed styles, bounding boxes, real keyboard input and the accessibility tree. Report a failure only when a measurement fails the WCAG 2.2 AA threshold, with the route/state, selector, measured value, threshold and source location when known:

- **Text and non-text contrast (1.4.3, 1.4.11)**: resolve foreground and composited background colors from `getComputedStyle` (including CSS variables, Tailwind utilities, dark mode, hover and focus states, and alpha compositing). Check at least 4.5:1 for normal text (3:1 for large text: ≥ 24px or ≥ 18.66px bold) and at least 3:1 for UI component boundaries, icons and focus indicators. Leave text over photos or complex gradients that cannot be sampled deterministically as Needs Review.
- **Target size (2.5.8)**: measure interactive controls (`a`, `button`, `input`, `select`, `textarea` and ARIA interactive roles) with `getBoundingClientRect()`. Flag targets smaller than 24×24 CSS px unless a WCAG 2.5.8 exception applies (inline text link, spacing clearance of at least 24px, user-agent default or essential).
- **Focus visible and focus not obscured (2.4.7, 2.4.11)**: traverse the page with real `Tab` and `Shift+Tab` key presses. Verify each focused element exposes a visible focus style change (2.4.7) and check its bounding box against any sticky or fixed header, footer, banner or overlay so focus is not hidden behind fixed chrome (2.4.11).
- **Reflow (1.4.10)**: resize the viewport to 320px width (400% zoom at 1280px) and check `document.documentElement.scrollWidth > document.documentElement.clientWidth` as well as clipped or overflowing containers that require two-dimensional scrolling (excluding content that requires 2D layout such as data tables or maps).
- **Accessibility tree, focus traps and live regions (2.1.2, 4.1.2, 4.1.3)**: inspect the browser's computed accessibility tree for missing or empty accessible names and incorrect roles or states (4.1.2). Open modals, drawers and menus and verify with `Tab`, `Shift+Tab` and `Escape` that focus moves inside, cannot get stuck in a focus trap (2.1.2), and returns to the trigger on close. Trigger status or validation updates and verify they update a live region (`aria-live`, `role="status"` or `role="alert"`) for assistive technology (4.1.3).

### Visual AI judgment

Screenshot inspection and semantic observations (such as whether alt text is meaningful, whether contrast over a photograph looks low, or whether a custom focus ring is visually clear) are AI judgment, never confirmed failures.

- Never report visual AI judgment or unmeasured guesses as confirmed failures.
- Report them separately as Needs Review ("needs a person") with the route/state, element and what a human should check.

## Verify fixes and report

After changing code to fix a browser-measured failure, re-run both Stage 1 (the static Check) and the corresponding Stage 2 browser measurement before calling it fixed.

Group your final report into three sections:

1. **Static Check (Stage 1)**: Proven Findings fixed and confirmed by re-check, plus any Check errors.
2. **Deterministic browser failures (Stage 2)**: criterion, route/state, selector, measured value versus threshold, and source file/line.
3. **Needs Review (needs a person)**: Unproven rule matches, static Needs Review items not deterministically measurable, and visual AI judgment notes.
