import type { AnalysisResult, Finding, NeedsReview, TextRange } from './analysis';
import { isControl, layoutNeedsReview, RenderedContent, SourceElement } from './needs-review';
import { criterionUrl } from './wcag';
import { contrast } from './contrast';

// Allyproof's own rules for WCAG 2.2 AA criteria no upstream engine checks. They read the elements every
// engine collects in its own syntax, so they work alike in every language; bound values are never guessed.

const PREFIX = 'allyproof/';

export interface OwnRuleOptions {
    /** For languages whose upstream engine has no rule for 1.3.5. */
    inputPurpose?: boolean;
}

/** An engine's Findings with the own Findings added, and the document's Needs Review entries. */
export function withOwnRules(findings: Finding[], content: RenderedContent, options: OwnRuleOptions = {}): AnalysisResult {
    const own = content.elements.flatMap(element => [
        ...passwordAutocomplete(element),
        ...options.inputPurpose ? invalidAutocomplete(element) : []
    ]);
    const contrasts = contrast(content);
    return {
        findings: [...findings, ...own, ...contrasts.findings],
        needsReview: [...layoutNeedsReview(content, contrasts.allTextDecided), ...contrasts.needsReview, ...content.elements.flatMap(smallTarget)]
    };
}

/** A button without text or a naming attribute, in languages whose upstream engine has no rule for 4.1.2. */
export function buttonNameFinding(range: TextRange): Finding {
    return {
        range,
        criteria: ['4.1.2'],
        ruleId: `${PREFIX}button-name`,
        layer: 'check',
        severity: 'warning',
        message: 'Buttons must have discernible text',
        explanation: 'A button without visible text or an accessible name (such as aria-label or aria-labelledby) is announced as just "button" by screen readers.',
        helpUrl: criterionUrl('4.1.2')
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

// The autofill detail tokens of the HTML standard: [section-*] [shipping|billing] [home|work|mobile|fax|pager] field [webauthn],
// where only a contact field takes the home…pager modifier
const FIELDS = new Set([
    'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix', 'nickname', 'username',
    'new-password', 'current-password', 'one-time-code', 'organization-title', 'organization', 'street-address',
    'address-line1', 'address-line2', 'address-line3', 'address-level4', 'address-level3', 'address-level2', 'address-level1',
    'country', 'country-name', 'postal-code', 'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number',
    'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type', 'transaction-currency', 'transaction-amount', 'language',
    'bday', 'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo'
]);
const CONTACT_FIELDS = new Set([
    'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix',
    'tel-extension', 'email', 'impp'
]);
const CONTACT_MODIFIERS = new Set(['home', 'work', 'mobile', 'fax', 'pager']);
// Input types that take no autofill detail tokens, as in ACT rule 73f2c2
const NO_AUTOFILL_TYPES = new Set(['hidden', 'button', 'checkbox', 'file', 'image', 'radio', 'reset', 'submit']);

function isAutofillValue(value: string): boolean {
    if (value === 'on' || value === 'off') return true;
    const tokens = value.split(/\s+/);
    if (tokens[0]?.startsWith('section-')) tokens.shift();
    if (tokens[0] === 'shipping' || tokens[0] === 'billing') tokens.shift();
    if (tokens[tokens.length - 1] === 'webauthn') tokens.pop();
    if (tokens.length === 2 && CONTACT_MODIFIERS.has(tokens[0])) return CONTACT_FIELDS.has(tokens[1]);
    return tokens.length === 1 && (FIELDS.has(tokens[0]) || CONTACT_FIELDS.has(tokens[0]));
}

function invalidAutocomplete(element: SourceElement): Finding[] {
    const value = literal(element, 'autocomplete');
    const type = element.attributes.get('type');
    if (!['input', 'select', 'textarea'].includes(element.tag) || !value || type === true) return [];
    if (element.tag === 'input' && NO_AUTOFILL_TYPES.has(literal(element, 'type') ?? '')) return [];
    if (isAutofillValue(value)) return [];
    return [{
        range: element.range,
        criteria: ['1.3.5'],
        ruleId: `${PREFIX}autocomplete-valid`,
        layer: 'check',
        severity: 'warning',
        message: `autocomplete="${value}" is not a valid autofill value, so browsers and assistive technology cannot tell the field's purpose`,
        explanation: 'Use the autofill tokens of the HTML standard, such as autocomplete="email" or "shipping postal-code", '
            + 'so the purpose of a field that collects information about the user can be identified.',
        helpUrl: criterionUrl('1.3.5')
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
