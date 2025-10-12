"use strict";
/**
 * Normalizes ruleIds (axe-core rule IDs, free-form AI descriptions, WCAG numbers) to a
 * canonical key for metrics and duplicate filtering.
 * Strategy:
 * 1. Trim and lowercase
 * 2. Keep WCAG numbers (e.g., 1.4.3) as-is
 * 3. Map known axe IDs / colloquial synonyms to WCAG numbers
 * 4. Remove special characters / excessive spaces
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRuleIds = exports.normalizeRuleId = void 0;
// Static synonym mapping note: only real axe-core rule IDs are considered.
// Multi-SC & primary decision is handled dynamically elsewhere.
// Full mapping: each axe-core rule ID -> primary (or derived) WCAG success criterion.
// Sources:
//  - Official axe tags (wcagXYZ) for unambiguous mapping
//  - Multi-SC: practical prioritization (primary override mirrored elsewhere)
//  - Without WCAG tag: reasoned heuristic mapping
// Note: Only ONE SC per rule for metric consistency; Multi-SC cases drop secondary criteria.
const SYNONYM_MAP = {
    // --- Mit offiziellen WCAG Tags (Single) ---
    'aria-allowed-attr': '4.1.2',
    'aria-braille-equivalent': '4.1.2',
    'aria-command-name': '4.1.2',
    'aria-conditional-attr': '4.1.2',
    'aria-deprecated-role': '4.1.2',
    'aria-hidden-focus': '4.1.2',
    'aria-input-field-name': '4.1.2',
    'aria-meter-name': '1.1.1',
    'aria-progressbar-name': '1.1.1',
    'aria-prohibited-attr': '4.1.2',
    'aria-required-attr': '4.1.2',
    'aria-required-children': '1.3.1',
    'aria-required-parent': '1.3.1',
    'aria-roledescription': '4.1.2',
    'aria-roles': '4.1.2',
    'aria-toggle-field-name': '4.1.2',
    'aria-tooltip-name': '4.1.2',
    'aria-valid-attr': '4.1.2',
    'aria-valid-attr-value': '4.1.2',
    'audio-caption': '1.2.1',
    'autocomplete-valid': '1.3.5',
    'avoid-inline-spacing': '1.4.12',
    'blink': '2.2.2',
    'button-name': '4.1.2',
    'bypass': '2.4.1',
    'color-contrast': '1.4.3',
    'color-contrast-enhanced': '1.4.6',
    'css-orientation-lock': '1.3.4',
    'definition-list': '1.3.1',
    'dlitem': '1.3.1',
    'document-title': '2.4.2',
    'duplicate-id': '4.1.1',
    'duplicate-id-active': '4.1.1',
    'duplicate-id-aria': '4.1.2',
    'form-field-multiple-labels': '3.3.2',
    'frame-focusable-content': '2.1.1',
    'frame-title': '4.1.2',
    'frame-title-unique': '4.1.2',
    'html-has-lang': '3.1.1',
    'html-lang-valid': '3.1.1',
    'html-xml-lang-mismatch': '3.1.1',
    'identical-links-same-purpose': '2.4.9',
    'image-alt': '1.1.1',
    'input-button-name': '4.1.2',
    'label': '4.1.2',
    'link-in-text-block': '1.4.1',
    'list': '1.3.1',
    'listitem': '1.3.1',
    'marquee': '2.2.2',
    'meta-refresh': '2.2.1',
    'meta-viewport': '1.4.4',
    'nested-interactive': '4.1.2',
    'no-autoplay-audio': '1.4.2',
    'object-alt': '1.1.1',
    'p-as-heading': '1.3.1',
    'role-img-alt': '1.1.1',
    'select-name': '4.1.2',
    'server-side-image-map': '2.1.1',
    'summary-name': '4.1.2',
    'svg-img-alt': '1.1.1',
    'table-fake-caption': '1.3.1',
    'target-size': '2.5.8',
    'td-has-header': '1.3.1',
    'td-headers-attr': '1.3.1',
    'th-has-data-cells': '1.3.1',
    'valid-lang': '3.1.2',
    'video-caption': '1.2.2',
    // --- Multi-SC (official multiple tags) – primary selected ---
    'area-alt': '2.4.4', // secondary 4.1.2
    'aria-hidden-body': '1.3.1', // secondary 4.1.2
    'input-image-alt': '1.1.1', // secondary 4.1.2
    'link-name': '2.4.4', // secondary 4.1.2
    'meta-refresh-no-exceptions': '2.2.4', // secondary 3.2.5
    'scrollable-region-focusable': '2.1.1', // secondary 2.1.3
    // --- Rules without official WCAG numeric tags (heuristic mapping) ---
    'accesskeys': '2.1.1',
    'aria-allowed-role': '4.1.2',
    'aria-dialog-name': '4.1.2',
    'aria-text': '4.1.2',
    'aria-treeitem-name': '4.1.2',
    'empty-heading': '2.4.6',
    'empty-table-header': '1.3.1',
    'focus-order-semantics': '2.4.3',
    'frame-tested': '4.1.2',
    'heading-order': '2.4.6',
    'hidden-content': '1.3.1',
    'image-redundant-alt': '1.1.1',
    'label-title-only': '4.1.2',
    'landmark-banner-is-top-level': '1.3.1',
    'landmark-complementary-is-top-level': '1.3.1',
    'landmark-contentinfo-is-top-level': '1.3.1',
    'landmark-main-is-top-level': '1.3.1',
    'landmark-no-duplicate-banner': '1.3.1',
    'landmark-no-duplicate-contentinfo': '1.3.1',
    'landmark-no-duplicate-main': '1.3.1',
    'landmark-one-main': '1.3.1',
    'landmark-unique': '1.3.1',
    'page-has-heading-one': '2.4.6',
    'presentation-role-conflict': '1.3.1',
    'region': '1.3.1',
    'scope-attr-valid': '1.3.1',
    'skip-link': '2.4.1',
    'tabindex': '2.4.3',
    'table-duplicate-name': '1.3.1',
    'meta-viewport-large': '1.4.10'
};
const WCAG_NUMBER_REGEX = /^(\d\.\d\.\d[a-z]?)(?:\b|$)/; // e.g., 1.4.3 or 1.4.3a
function normalizeRuleId(raw) {
    if (!raw)
        return '';
    let s = raw.trim().toLowerCase();
    if (!s)
        return '';
    // Remove parentheses & duplicate spaces
    s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    // If a WCAG number is present → extract & return
    const numMatch = s.match(WCAG_NUMBER_REGEX);
    if (numMatch) {
        return numMatch[1];
    }
    // Special cases: replace non-alphanumeric (except - and .) with -
    s = s.replace(/[^a-z0-9.\- ]+/g, '-').replace(/\s+/g, '-');
    // 1) Try static full mapping first
    if (SYNONYM_MAP[s])
        return SYNONYM_MAP[s];
    // 2) Dynamic fallback (e.g., for new axe versions)
    return s;
}
exports.normalizeRuleId = normalizeRuleId;
/** Normalizes all ruleIds of a list in-place */
function normalizeRuleIds(items) {
    for (const it of items) {
        if (it.ruleId)
            it.ruleId = normalizeRuleId(it.ruleId);
    }
    return items;
}
exports.normalizeRuleIds = normalizeRuleIds;
//# sourceMappingURL=rule-id-normalizer.js.map