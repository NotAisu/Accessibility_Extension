import type { Finding, NeedsReview } from './analysis';
import type { SourceElement } from './needs-review';

// Base rule names shared by eslint-plugin-jsx-a11y-x (JSX/TSX) and eslint-plugin-astro (Astro)
const JSX_A11Y_OPEN_ELEMENT_RULES = [
    'alt-text',
    'anchor-has-content',
    'aria-activedescendant-has-tabindex',
    'click-events-have-key-events',
    'heading-has-content',
    'html-has-lang',
    'iframe-has-title',
    'interactive-supports-focus',
    'label-has-associated-control',
    'media-has-caption',
    'mouse-events-have-key-events',
    'no-aria-hidden-on-focusable',
    'no-noninteractive-element-interactions',
    'no-static-element-interactions',
    'role-has-required-aria-props',
    'role-supports-aria-props'
] as const;

const SVELTE_OPEN_ELEMENT_RULES = [
    'a11y_aria_activedescendant_has_tabindex',
    'a11y_click_events_have_key_events',
    'a11y_consider_explicit_label',
    'a11y_interactive_supports_focus',
    'a11y_label_has_associated_control',
    'a11y_media_has_caption',
    'a11y_missing_attribute',
    'a11y_missing_content',
    'a11y_mouse_events_have_key_events',
    'a11y_no_noninteractive_element_interactions',
    'a11y_no_static_element_interactions',
    'a11y_role_has_required_aria_props',
    'a11y_role_supports_aria_props',
    'a11y_role_supports_aria_props_implicit'
] as const;

/**
 * Rules whose condition unknown attributes on an Open element could satisfy
 * (labels, names, roles, handlers, ARIA attributes).
 * Explicit data shared across engines; later languages add their rule IDs here.
 */
export const OPEN_ELEMENT_RULES: ReadonlySet<string> = new Set([
    ...JSX_A11Y_OPEN_ELEMENT_RULES.map(rule => `jsx-a11y-x/${rule}`),
    ...JSX_A11Y_OPEN_ELEMENT_RULES.map(rule => `astro/jsx-a11y/${rule}`),
    ...SVELTE_OPEN_ELEMENT_RULES.map(rule => `svelte/${rule}`),
    'allyproof/button-name'
]);

/**
 * Splits out matches of `OPEN_ELEMENT_RULES` on Open elements into Needs Review entries at the element.
 * Entries omit `ruleId` because an Open element match is undecidable from source, not an Unproven rule match.
 */
export function demoteOpenElementFindings(findings: Finding[], elements: SourceElement[]): { findings: Finding[]; needsReview: NeedsReview[] } {
    if (!elements.some(element => element.open)) return { findings, needsReview: [] };
    const kept: Finding[] = [];
    const needsReview: NeedsReview[] = [];
    for (const finding of findings) {
        const element = OPEN_ELEMENT_RULES.has(finding.ruleId) ? elementAt(elements, finding.range.start) : undefined;
        if (!element?.open) {
            kept.push(finding);
            continue;
        }
        for (const criterion of finding.criteria) {
            needsReview.push({
                criterion,
                reason: `Open element (<${element.tag}> has unknown attributes): verify ${finding.message}`,
                range: element.range
            });
        }
    }
    return { findings: kept, needsReview };
}

// Innermost element whose opening tag spans `offset`, so a non-open child inside an open element's prop stays non-open
function elementAt(elements: SourceElement[], offset: number): SourceElement | undefined {
    let best: SourceElement | undefined;
    for (const element of elements) {
        if (element.range.start <= offset && offset < element.range.end) {
            if (!best || element.range.end - element.range.start < best.range.end - best.range.start) best = element;
        }
    }
    return best;
}
