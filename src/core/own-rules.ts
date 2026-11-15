import type { AnalysisResult, Finding, NeedsReview } from './analysis';
import { isControl, layoutNeedsReview, RenderedContent, SourceElement } from './needs-review';
import { criterionUrl } from './wcag';

// Allyproof's own rules for WCAG 2.2 AA criteria no upstream engine checks. They read the elements every
// engine collects in its own syntax, so they work alike in every language; bound values are never guessed.

const PREFIX = 'allyproof/';

/** Own Findings and the document's Needs Review entries. */
export function checkOwnRules(content: RenderedContent): AnalysisResult {
    return {
        findings: content.elements.flatMap(passwordAutocomplete),
        needsReview: [...layoutNeedsReview(content), ...content.elements.flatMap(smallTarget)]
    };
}

const literal = (element: SourceElement, name: string) => {
    const value = element.attributes.get(name);
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
};

// autocomplete="off" tells password managers to stay away, so the user has to recall or retype the password
function passwordAutocomplete(element: SourceElement): Finding[] {
    if (element.tag !== 'input' || literal(element, 'type') !== 'password' || literal(element, 'autocomplete') !== 'off') return [];
    return [{
        range: element.range,
        criteria: ['3.3.8'],
        ruleId: `${PREFIX}password-autocomplete`,
        layer: 'check',
        severity: 'warning',
        message: 'Password field turns off autocomplete, which keeps password managers from filling it',
        explanation: 'Logging in must not depend on remembering or transcribing a password. Use autocomplete="current-password" '
            + 'on a login form or autocomplete="new-password" when the password is chosen, so password managers can fill it.',
        helpUrl: criterionUrl('3.3.8')
    }];
}

const MIN_TARGET_PX = 24;
// Tailwind's default spacing step (0.25rem) and rem, both at the browsers' default root font size
const TAILWIND_STEP_PX = 4;
const REM_PX = 16;

// A size declared below 24x24 is only a likely failure: spacing to other targets, an equivalent control or
// the inline exception can still pass 2.5.8, so it is listed as Needs Review at the element, not a Finding
function smallTarget(element: SourceElement): NeedsReview[] {
    if (!isControl(element)) return [];
    const { width, height } = declaredSize(element);
    const small = [width, height].some(size => size !== undefined && size < MIN_TARGET_PX);
    if (!small) return [];
    const size = width !== undefined && height !== undefined ? `a ${width}×${height} CSS px target`
        : width !== undefined ? `a width of ${width} CSS px` : `a height of ${height} CSS px`;
    return [{
        criterion: '2.5.8',
        reason: `Likely failure: <${element.tag}> declares ${size}, below ${MIN_TARGET_PX}×${MIN_TARGET_PX}. It passes only with enough spacing to other targets.`,
        range: element.range
    }];
}

interface Size {
    width?: number;
    height?: number;
}

// Literal sizes from the style attribute and Tailwind classes; a min-width or min-height raises the size.
// Classes with a variant (hover:, md:) only apply sometimes and are left out
function declaredSize(element: SourceElement): Size {
    const declared: Record<string, number> = {};
    const classes = literal(element, 'class') ?? literal(element, 'classname') ?? '';
    for (const name of classes.split(/\s+/)) {
        const match = /^(w|h|size|min-w|min-h)-(.+)$/.exec(name);
        const px = match ? tailwindPx(match[2]) : undefined;
        if (!match || px === undefined) continue;
        for (const property of match[1] === 'size' ? ['width', 'height'] : [TAILWIND_PROPERTY[match[1]]]) declared[property] = px;
    }
    for (const declaration of (literal(element, 'style') ?? '').split(';')) {
        const [property, value] = declaration.split(':').map(part => part.trim());
        const px = value === undefined ? undefined : cssPx(value.replace(/\s*!important$/, ''));
        if (px !== undefined && ['width', 'height', 'min-width', 'min-height'].includes(property)) declared[property] = px;
    }
    const size = (dimension: 'width' | 'height') => {
        const value = declared[dimension];
        const min = declared[`min-${dimension}`];
        return value === undefined || min === undefined ? value : Math.max(value, min);
    };
    return { width: size('width'), height: size('height') };
}

const TAILWIND_PROPERTY: Record<string, string> = { 'w': 'width', 'h': 'height', 'min-w': 'min-width', 'min-h': 'min-height' };

function tailwindPx(value: string): number | undefined {
    if (value === 'px') return 1;
    if (/^\d+(\.5)?$/.test(value)) return Number(value) * TAILWIND_STEP_PX;
    const arbitrary = /^\[(.+)\]$/.exec(value);
    return arbitrary ? cssPx(arbitrary[1]) : undefined;
}

function cssPx(value: string): number | undefined {
    const match = /^(\d*\.?\d+)(px|rem)?$/.exec(value);
    if (!match || (match[2] === undefined && match[1] !== '0')) return undefined;
    return Number(match[1]) * (match[2] === 'rem' ? REM_PX : 1);
}
