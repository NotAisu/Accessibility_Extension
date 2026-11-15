// WCAG 2.2 level A and AA success criteria, the conformance target of the Check.
// 4.1.1 Parsing is obsolete in WCAG 2.2 and therefore not listed.
const CRITERIA: Record<string, { name: string; slug: string }> = {
    '1.1.1': { name: 'Non-text Content', slug: 'non-text-content' },
    '1.2.1': { name: 'Audio-only and Video-only (Prerecorded)', slug: 'audio-only-and-video-only-prerecorded' },
    '1.2.2': { name: 'Captions (Prerecorded)', slug: 'captions-prerecorded' },
    '1.2.3': { name: 'Audio Description or Media Alternative (Prerecorded)', slug: 'audio-description-or-media-alternative-prerecorded' },
    '1.2.4': { name: 'Captions (Live)', slug: 'captions-live' },
    '1.2.5': { name: 'Audio Description (Prerecorded)', slug: 'audio-description-prerecorded' },
    '1.3.1': { name: 'Info and Relationships', slug: 'info-and-relationships' },
    '1.3.2': { name: 'Meaningful Sequence', slug: 'meaningful-sequence' },
    '1.3.3': { name: 'Sensory Characteristics', slug: 'sensory-characteristics' },
    '1.3.4': { name: 'Orientation', slug: 'orientation' },
    '1.3.5': { name: 'Identify Input Purpose', slug: 'identify-input-purpose' },
    '1.4.1': { name: 'Use of Color', slug: 'use-of-color' },
    '1.4.2': { name: 'Audio Control', slug: 'audio-control' },
    '1.4.3': { name: 'Contrast (Minimum)', slug: 'contrast-minimum' },
    '1.4.4': { name: 'Resize Text', slug: 'resize-text' },
    '1.4.5': { name: 'Images of Text', slug: 'images-of-text' },
    '1.4.10': { name: 'Reflow', slug: 'reflow' },
    '1.4.11': { name: 'Non-text Contrast', slug: 'non-text-contrast' },
    '1.4.12': { name: 'Text Spacing', slug: 'text-spacing' },
    '1.4.13': { name: 'Content on Hover or Focus', slug: 'content-on-hover-or-focus' },
    '2.1.1': { name: 'Keyboard', slug: 'keyboard' },
    '2.1.2': { name: 'No Keyboard Trap', slug: 'no-keyboard-trap' },
    '2.1.4': { name: 'Character Key Shortcuts', slug: 'character-key-shortcuts' },
    '2.2.1': { name: 'Timing Adjustable', slug: 'timing-adjustable' },
    '2.2.2': { name: 'Pause, Stop, Hide', slug: 'pause-stop-hide' },
    '2.3.1': { name: 'Three Flashes or Below Threshold', slug: 'three-flashes-or-below-threshold' },
    '2.4.1': { name: 'Bypass Blocks', slug: 'bypass-blocks' },
    '2.4.2': { name: 'Page Titled', slug: 'page-titled' },
    '2.4.3': { name: 'Focus Order', slug: 'focus-order' },
    '2.4.4': { name: 'Link Purpose (In Context)', slug: 'link-purpose-in-context' },
    '2.4.5': { name: 'Multiple Ways', slug: 'multiple-ways' },
    '2.4.6': { name: 'Headings and Labels', slug: 'headings-and-labels' },
    '2.4.7': { name: 'Focus Visible', slug: 'focus-visible' },
    '2.4.11': { name: 'Focus Not Obscured (Minimum)', slug: 'focus-not-obscured-minimum' },
    '2.5.1': { name: 'Pointer Gestures', slug: 'pointer-gestures' },
    '2.5.2': { name: 'Pointer Cancellation', slug: 'pointer-cancellation' },
    '2.5.3': { name: 'Label in Name', slug: 'label-in-name' },
    '2.5.4': { name: 'Motion Actuation', slug: 'motion-actuation' },
    '2.5.7': { name: 'Dragging Movements', slug: 'dragging-movements' },
    '2.5.8': { name: 'Target Size (Minimum)', slug: 'target-size-minimum' },
    '3.1.1': { name: 'Language of Page', slug: 'language-of-page' },
    '3.1.2': { name: 'Language of Parts', slug: 'language-of-parts' },
    '3.2.1': { name: 'On Focus', slug: 'on-focus' },
    '3.2.2': { name: 'On Input', slug: 'on-input' },
    '3.2.3': { name: 'Consistent Navigation', slug: 'consistent-navigation' },
    '3.2.4': { name: 'Consistent Identification', slug: 'consistent-identification' },
    '3.2.6': { name: 'Consistent Help', slug: 'consistent-help' },
    '3.3.1': { name: 'Error Identification', slug: 'error-identification' },
    '3.3.2': { name: 'Labels or Instructions', slug: 'labels-or-instructions' },
    '3.3.3': { name: 'Error Suggestion', slug: 'error-suggestion' },
    '3.3.4': { name: 'Error Prevention (Legal, Financial, Data)', slug: 'error-prevention-legal-financial-data' },
    '3.3.7': { name: 'Redundant Entry', slug: 'redundant-entry' },
    '3.3.8': { name: 'Accessible Authentication (Minimum)', slug: 'accessible-authentication-minimum' },
    '4.1.2': { name: 'Name, Role, Value', slug: 'name-role-value' },
    '4.1.3': { name: 'Status Messages', slug: 'status-messages' }
};

/** True for a WCAG 2.2 level A or AA success criterion number such as "1.4.3". */
export function isTargetCriterion(criterion: string): boolean {
    return Object.prototype.hasOwnProperty.call(CRITERIA, criterion);
}

export function criterionName(criterion: string): string {
    return isTargetCriterion(criterion) ? CRITERIA[criterion].name : criterion;
}

/** Link to the W3C "Understanding" page of a success criterion. */
export function criterionUrl(criterion: string): string {
    return isTargetCriterion(criterion)
        ? `https://www.w3.org/WAI/WCAG22/Understanding/${CRITERIA[criterion].slug}`
        : 'https://www.w3.org/WAI/WCAG22/quickref/';
}
