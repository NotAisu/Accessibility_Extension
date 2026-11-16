import { parse, rgb, wcagContrast, type Color } from 'culori';
import tailwindColors from 'tailwindcss/colors';
import type { Finding, NeedsReview } from './analysis';
import type { RenderedContent, SourceElement } from './needs-review';
import { criterionUrl } from './wcag';

// Static contrast (#33): text and background colors resolved from literal values only, the element's own or a
// static ancestor's inline style and Tailwind default palette and arbitrary-value classes. A Finding only when
// both colors are certain and the WCAG 2.x ratio fails; otherwise Needs Review with the reason. No APCA.

const PREFIX = 'allyproof/';
const NORMAL_TEXT_RATIO = 4.5;
const LARGE_TEXT_RATIO = 3;
const NON_TEXT_RATIO = 3;
// Large text: at least 18 pt, or 14 pt bold (WCAG 2.2 definition), in CSS px
const LARGE_PX = 24;
const LARGE_BOLD_PX = 14 * 4 / 3;
const REM_PX = 16;

export interface ContrastResult {
    findings: Finding[];
    needsReview: NeedsReview[];
    /** The contrast of every text was decided (passed or failed), so text contrast needs no review. */
    allTextDecided: boolean;
}

type Rgb = { mode: 'rgb'; r: number; g: number; b: number };

/** A resolved value: certain, unknown with nothing declared, or uncertain for a named reason. */
type Resolved<T> = { value: T } | { unknown: true } | { uncertain: string };

/** What an element declares itself; `undefined` for anything it leaves to inheritance or defaults. */
interface Declared {
    color?: Resolved<Rgb> | 'transparent';
    background?: Resolved<Rgb> | 'transparent';
    borderColor?: Resolved<Rgb>;
    border?: boolean;
    fontSizePx?: number | 'relative';
    bold?: boolean;
    /** Not rendered or off screen; its text needs no contrast. */
    hidden?: boolean;
    /** Changes how everything inside it renders: opacity, filters, blending, shadows. */
    effect?: string;
    /** The first class that is not a known Tailwind utility: a stylesheet may give it any colors. */
    unknownClass?: string;
}

export function contrast(content: RenderedContent): ContrastResult {
    const context = new Context(content);
    const findings: Finding[] = [];
    const reasons = new Map<string, number>();
    let allTextDecided = true;
    let elementText = false;
    for (const element of content.elements) {
        const control = nonTextContrast(element, context);
        if ('finding' in control) findings.push(control.finding);
        else if ('uncertain' in control) reasons.set(control.uncertain, (reasons.get(control.uncertain) ?? 0) + 1);

        if (element.text !== undefined || element.boundText) elementText = true;
        if (!hasHumanText(element) || context.inapplicable(element)) continue;
        const text = textContrast(element, context);
        if ('finding' in text) findings.push(text.finding);
        else if ('uncertain' in text) {
            allTextDecided = false;
            reasons.set(text.uncertain, (reasons.get(text.uncertain) ?? 0) + 1);
        } else if ('unknown' in text) allTextDecided = false;
    }
    const needsReview = [...reasons].map(([reason, count]) => ({
        criterion: reason.startsWith(NON_TEXT) ? '1.4.11' : '1.4.3',
        reason: `${count === 1 ? 'One element' : `${count} elements`}: ${reason.replace(NON_TEXT, '')}`
    }));
    // Text outside any element (at a template's root) is never decided
    return { findings, needsReview, allTextDecided: allTextDecided && (elementText || !content.text) };
}

const NON_TEXT = 'non-text:';

type Outcome = { finding: Finding } | { pass: true } | { unknown: true } | { uncertain: string };

function textContrast(element: SourceElement, context: Context): Outcome {
    // Nothing in this file colors the text: stylesheets decide it, which the general entry already says
    if (!context.colorsDeclared(element)) return { unknown: true };
    if (context.content.stylesheetColors) return { uncertain: `text contrast is uncertain: ${STYLESHEET_COLORS}.` };
    const effect = context.effect(element);
    const color = context.inherited(element, 'color');
    const background = context.background(element);
    if ('unknown' in color && 'unknown' in background) return { unknown: true };
    if (effect) return { uncertain: `text contrast is uncertain: ${effect} changes the rendered colors.` };
    if ('uncertain' in color) return { uncertain: `text contrast is uncertain: ${color.uncertain}.` };
    if ('uncertain' in background) return { uncertain: `text contrast is uncertain: ${background.uncertain}.` };
    if ('unknown' in color) return { uncertain: 'text contrast is uncertain: the text color is not set in this file.' };
    if ('unknown' in background) return { uncertain: 'text contrast is uncertain: the background color is not set in this file.' };
    const ratio = wcagContrast(color.value, background.value);
    // The same color as the background is invisible text, which has no contrast to meet
    if (ratio === 1 || ratio >= NORMAL_TEXT_RATIO) return { pass: true };
    const large = context.isLargeText(element);
    if (ratio >= LARGE_TEXT_RATIO && large === undefined) {
        return { uncertain: `text contrast of ${format(ratio)}:1 passes only as large text, and the font size is not known.` };
    }
    const required = large ? LARGE_TEXT_RATIO : NORMAL_TEXT_RATIO;
    if (ratio >= required) return { pass: true };
    const size = large === undefined ? '' : large ? 'large ' : 'normal-size ';
    return {
        finding: {
            range: element.range,
            criteria: ['1.4.3'],
            ruleId: `${PREFIX}text-contrast`,
            layer: 'check',
            severity: 'warning',
            message: `Text contrast is ${format(ratio)}:1, below the required ${required}:1`,
            explanation: `The ${size}text color ${hex(color.value)} on the background ${hex(background.value)} has a contrast ratio of `
                + `${format(ratio)}:1; WCAG 1.4.3 requires ${required}:1 (${NORMAL_TEXT_RATIO}:1 for normal text, ${LARGE_TEXT_RATIO}:1 for `
                + 'text of at least 24 px, or 18.66 px bold). Darken the text or lighten the background, or the other way round.',
            helpUrl: criterionUrl('1.4.3')
        }
    };
}

// The boundary of a text field: visible when its border or its own background stands out from what surrounds it
function nonTextContrast(element: SourceElement, context: Context): Outcome | { none: true } {
    if (!isTextField(element) || context.inapplicable(element)) return { none: true };
    const own = context.declared(element);
    if (!own.border || !own.borderColor) return { none: true };
    const surrounding = element.parent ? context.background(element.parent) : context.rootBackground();
    const field = own.background === undefined ? context.fieldBackground() : own.background === 'transparent' ? surrounding : own.background;
    const effect = context.effect(element);
    const resolved = [own.borderColor, surrounding, field];
    if (resolved.some(r => 'unknown' in r)) return { none: true };
    if (context.content.stylesheetColors) return { uncertain: `${NON_TEXT}the field's boundary contrast is uncertain: ${STYLESHEET_COLORS}.` };
    const unknownClass = context.unknownClass(element);
    if (unknownClass) return { uncertain: `${NON_TEXT}the field's boundary contrast is uncertain: ${unknownClass}.` };
    if (effect) return { uncertain: `${NON_TEXT}the field's boundary contrast is uncertain: ${effect} changes the rendered colors.` };
    const uncertain = resolved.find((r): r is { uncertain: string } => 'uncertain' in r);
    if (uncertain) return { uncertain: `${NON_TEXT}the field's boundary contrast is uncertain: ${uncertain.uncertain}.` };
    const [border, around, inside] = resolved as { value: Rgb }[];
    const borderRatio = wcagContrast(border.value, around.value);
    const fieldRatio = wcagContrast(inside.value, around.value);
    if (borderRatio >= NON_TEXT_RATIO || fieldRatio >= NON_TEXT_RATIO) return { pass: true };
    return {
        finding: {
            range: element.range,
            criteria: ['1.4.11'],
            ruleId: `${PREFIX}non-text-contrast`,
            layer: 'check',
            severity: 'warning',
            message: `Field boundary contrast is ${format(Math.max(borderRatio, fieldRatio))}:1, below the required ${NON_TEXT_RATIO}:1`,
            explanation: `The border ${hex(border.value)} has a contrast ratio of ${format(borderRatio)}:1 and the field's background `
                + `${hex(inside.value)} ${format(fieldRatio)}:1 against the surrounding ${hex(around.value)}; WCAG 1.4.11 requires `
                + `${NON_TEXT_RATIO}:1 for at least one of them, so the field can be found. Darken the border.`,
            helpUrl: criterionUrl('1.4.11')
        }
    };
}

const STYLESHEET_COLORS = 'a <style> block or component styles in this file set colors';

function isTextField({ tag, attributes }: SourceElement): boolean {
    const type = attributes.get('type');
    return tag === 'textarea' || tag === 'select'
        || (tag === 'input' && (type === undefined || ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(String(type).toLowerCase())));
}

// Text that conveys something in human language: at least two letters, or an expression's text
function hasHumanText(element: SourceElement): boolean {
    return element.boundText === true || (element.text?.match(/\p{L}/gu)?.length ?? 0) >= 2;
}

// The ratio as WCAG compares it: never rounded up, so 4.499 does not read as 4.5
function format(ratio: number): string {
    return (Math.floor(ratio * 100) / 100).toFixed(2);
}

function hex({ r, g, b }: Rgb): string {
    return '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

// Browser defaults (HTML Rendering section) where only they apply
const UA_FONT_PX: Record<string, number> = { h1: 32, h2: 24, h3: 18.72, h4: 16, h5: 13.28, h6: 10.72, small: 13.33, button: 13.33, input: 13.33, select: 13.33, textarea: 13.33 };
const UA_BOLD = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'th']);
const UA_LINK = rgbOf('#0000ee')!;
const BLACK: Rgb = { mode: 'rgb', r: 0, g: 0, b: 0 };
const WHITE: Rgb = { mode: 'rgb', r: 1, g: 1, b: 1 };
// Elements whose browser colors are not inherited: they must declare their own
const OWN_UA_COLORS = new Set(['a', 'button', 'input', 'select', 'textarea', 'mark', 'option', 'legend']);
const OWN_UA_BACKGROUND = new Set(['button', 'input', 'select', 'textarea', 'mark']);

class Context {
    private readonly cache = new Map<SourceElement, Declared>();
    // Ids an element with a disabled state names as its label
    private readonly disabledLabels = new Set<string>();

    constructor(readonly content: RenderedContent) {
        for (const element of content.elements) {
            if (!isDisabled(element)) continue;
            const labelledBy = element.attributes.get('aria-labelledby');
            if (typeof labelledBy === 'string') labelledBy.split(/\s+/).forEach(id => this.disabledLabels.add(id));
            const id = element.attributes.get('id');
            if (typeof id === 'string') this.disabledLabels.add(`for:${id}`);
        }
    }

    declared(element: SourceElement): Declared {
        let declared = this.cache.get(element);
        if (!declared) {
            declared = { ...tailwind(this.content.userAgentStylesOnly ? '' : classes(element)), ...inlineStyle(element) };
            this.cache.set(element, declared);
        }
        return declared;
    }

    /** Not rendered, off screen, disabled or the label of a disabled control: contrast does not apply. */
    inapplicable(element: SourceElement): boolean {
        for (const e of chain(element)) {
            if (NOT_RENDERED.has(e.tag) || this.declared(e).hidden || e.attributes.has('hidden') || literal(e, 'aria-hidden') === 'true' || isDisabled(e)) return true;
            if (e.tag === 'label' && (this.disabledLabels.has(`for:${literal(e, 'for') ?? ''}`)
                || this.content.elements.some(other => other.parent === e && isDisabled(other)))) return true;
            const id = literal(e, 'id');
            if (id && this.disabledLabels.has(id)) return true;
        }
        return false;
    }

    /** Whether the element or an ancestor declares a color or background, or the browser's defaults are known. */
    colorsDeclared(element: SourceElement): boolean {
        if (this.content.userAgentStylesOnly) return true;
        return chain(element).some(e => {
            const { color, background } = this.declared(e);
            return color !== undefined || background !== undefined;
        });
    }

    /** An effect on the element or an ancestor that changes how its colors render. */
    effect(element: SourceElement): string | undefined {
        for (const e of chain(element)) {
            const effect = this.declared(e).effect;
            if (effect) return effect;
        }
        return undefined;
    }

    /** The text color: the nearest declared one, else the browser's. */
    inherited(element: SourceElement, property: 'color'): Resolved<Rgb> {
        for (const e of chain(element)) {
            const opaque = this.opaque(e, element);
            if (opaque) return opaque;
            const value = this.declared(e)[property];
            if (value === 'transparent') return { uncertain: 'the text color is transparent' };
            if (value) return value;
            if (OWN_UA_COLORS.has(e.tag)) {
                if (e.tag === 'a' && this.content.userAgentStylesOnly && e.attributes.has('href')) return { value: UA_LINK };
                return { uncertain: `the browser's own text color of <${e.tag}> applies` };
            }
        }
        return this.content.userAgentStylesOnly ? { value: BLACK } : { unknown: true };
    }

    /** The background painted behind the element: the nearest declared one that is not transparent. */
    background(element: SourceElement): Resolved<Rgb> {
        for (const e of chain(element)) {
            const opaque = this.opaque(e, element);
            if (opaque) return opaque;
            const value = this.declared(e).background;
            if (value && value !== 'transparent') return value;
            if (value === undefined && OWN_UA_BACKGROUND.has(e.tag)) return { uncertain: `the browser's own background of <${e.tag}> applies` };
        }
        return this.rootBackground();
    }

    /** Why a class on the element may set its colors; classes are inert where only the browser's styles apply. */
    unknownClass(e: SourceElement): string | undefined {
        const name = this.content.userAgentStylesOnly ? undefined : this.declared(e).unknownClass;
        return name === undefined ? undefined : `class ${name} may set colors`;
    }

    rootBackground(): Resolved<Rgb> {
        return this.content.userAgentStylesOnly ? { value: WHITE } : { unknown: true };
    }

    /** A text field's own background where it declares none. */
    fieldBackground(): Resolved<Rgb> {
        return this.content.userAgentStylesOnly ? { value: WHITE } : { unknown: true };
    }

    /** Large text (true), normal-size text (false), or undefined when the font size or weight is not known. */
    isLargeText(element: SourceElement): boolean | undefined {
        const px = this.fontSize(element);
        if (px === undefined) return undefined;
        if (px >= LARGE_PX) return true;
        if (px < LARGE_BOLD_PX - 0.01) return false;
        return this.bold(element);
    }

    private fontSize(element: SourceElement): number | undefined {
        for (const e of chain(element)) {
            const size = this.declared(e).fontSizePx;
            if (size === 'relative') return undefined;
            if (size !== undefined) return size;
            // A browser default relative to an ancestor's declared size is not followed
            if (UA_FONT_PX[e.tag] !== undefined) {
                return this.content.userAgentStylesOnly && !chain(e).slice(1).some(a => this.declared(a).fontSizePx !== undefined) ? UA_FONT_PX[e.tag] : undefined;
            }
        }
        return this.content.userAgentStylesOnly ? REM_PX : undefined;
    }

    private bold(element: SourceElement): boolean | undefined {
        for (const e of chain(element)) {
            const bold = this.declared(e).bold;
            if (bold !== undefined) return bold;
            if (UA_BOLD.has(e.tag)) return this.content.userAgentStylesOnly ? true : undefined;
        }
        return this.content.userAgentStylesOnly ? false : undefined;
    }

    // Colors cannot be followed through a bound class or style, nor through a component, which renders its
    // children wherever and however it likes
    private opaque(e: SourceElement, start: SourceElement): Resolved<Rgb> | undefined {
        if (e.boundStyle || ['class', 'classname', 'style'].some(name => e.attributes.get(name) === true)) {
            return { uncertain: `<${e.tag}> binds its class or style to an expression` };
        }
        if (e !== start && isComponent(e)) return this.anyDeclared(start, e) ? { uncertain: `it is inside the component <${e.tag}>, whose styles are not known` } : { unknown: true };
        if (e === start && isComponent(e)) return { unknown: true };
        const unknownClass = this.unknownClass(e);
        return unknownClass ? { uncertain: unknownClass } : undefined;
    }

    // Whether something between the element and `until` declares a color, so the uncertainty is worth naming
    private anyDeclared(element: SourceElement, until: SourceElement): boolean {
        for (const e of chain(element)) {
            if (e === until) return false;
            const { color, background } = this.declared(e);
            if (color || background) return true;
        }
        return false;
    }
}

function chain(element: SourceElement): SourceElement[] {
    const elements: SourceElement[] = [];
    for (let e: SourceElement | undefined = element; e; e = e.parent) elements.push(e);
    return elements;
}

function isComponent({ tag }: SourceElement): boolean {
    return tag === '' || /^[A-Z]/.test(tag) || /[.:-]/.test(tag);
}

// Elements whose text is never rendered as page text
const NOT_RENDERED = new Set(['head', 'title', 'script', 'style', 'template', 'noscript', 'svg']);

const DISABLEABLE = new Set(['button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option']);

function isDisabled(element: SourceElement): boolean {
    return (DISABLEABLE.has(element.tag) && element.attributes.has('disabled')) || literal(element, 'aria-disabled') === 'true';
}

function literal(element: SourceElement, name: string): string | undefined {
    const value = element.attributes.get(name);
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function classes(element: SourceElement): string {
    const value = element.attributes.get('class') ?? element.attributes.get('classname');
    return typeof value === 'string' ? value : '';
}

function rgbOf(value: string): Rgb | undefined {
    const parsed: Color | undefined = parse(value);
    if (!parsed) return undefined;
    const { r, g, b } = rgb(parsed);
    return { mode: 'rgb', r: clamp(r), g: clamp(g), b: clamp(b) };
}

function clamp(channel: number): number {
    return Math.min(1, Math.max(0, channel || 0));
}

// A literal CSS color; variables, keywords that depend on other styles and semi-transparent colors are uncertain
function color(value: string): Resolved<Rgb> | 'transparent' {
    const v = value.trim().toLowerCase().replace(/\s*!important$/, '');
    if (v === 'transparent') return 'transparent';
    if (v.includes('var(')) return { uncertain: `the color ${value.trim()} is a CSS variable` };
    if (['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(v)) return { uncertain: `the color is ${v}` };
    const parsed = parse(v);
    if (!parsed) return { uncertain: `the color ${value.trim()} is not a literal color` };
    if (parsed.alpha !== undefined && parsed.alpha < 1) return { uncertain: `the color ${value.trim()} is semi-transparent` };
    return { value: rgbOf(v)! };
}

function px(value: string): number | 'relative' | undefined {
    const match = /^(\d*\.?\d+)(px|pt|rem)$/.exec(value.trim().toLowerCase());
    if (!match) return 'relative';
    return Number(match[1]) * (match[2] === 'pt' ? 4 / 3 : match[2] === 'rem' ? REM_PX : 1);
}

function inlineStyle(element: SourceElement): Declared {
    const style = element.attributes.get('style');
    const declared: Declared = {};
    if (typeof style !== 'string') return declared;
    for (const declaration of style.split(';')) {
        const index = declaration.indexOf(':');
        if (index === -1) continue;
        const property = declaration.slice(0, index).trim().toLowerCase();
        const value = declaration.slice(index + 1).trim();
        const lower = value.toLowerCase();
        switch (property) {
            case 'color':
                declared.color = color(value);
                break;
            case 'background-color':
                declared.background = color(value);
                break;
            case 'background':
                declared.background = /url\(|gradient\(/.test(lower) ? { uncertain: 'the background is an image or gradient' } : color(value);
                break;
            case 'background-image':
                if (lower !== 'none') declared.background = { uncertain: 'the background is an image or gradient' };
                break;
            case 'opacity':
                if (Number.parseFloat(value) < 1 || value.endsWith('%')) declared.effect = `opacity ${value}`;
                break;
            case 'filter': case 'backdrop-filter': case 'mix-blend-mode': case 'text-shadow':
                if (lower !== 'none' && lower !== 'normal') declared.effect = property;
                break;
            case 'display':
                if (lower === 'none') declared.hidden = true;
                break;
            case 'visibility':
                if (lower === 'hidden' || lower === 'collapse') declared.hidden = true;
                break;
            case 'top': case 'left': case 'right': case 'bottom':
                // Positioned off screen, as visually hidden text is
                if (lower.startsWith('-') && /position\s*:\s*(absolute|fixed)/i.test(style)) declared.hidden = true;
                break;
            case 'font-size':
                declared.fontSizePx = px(value);
                break;
            case 'font-weight':
                declared.bold = lower === 'bold' || lower === 'bolder' || Number(lower) >= 700;
                break;
            case 'border': case 'border-width': case 'border-color': {
                const parts = lower.split(/\s+/);
                if (property !== 'border-color') declared.border = !parts.some(part => ['none', 'hidden', '0', '0px'].includes(part));
                const colorPart = property === 'border-color' ? lower : parts.find(part => !/^(\d|solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden|thin|medium|thick)/.test(part));
                if (colorPart) {
                    const resolved = color(colorPart);
                    declared.borderColor = resolved === 'transparent' ? { uncertain: 'the border is transparent' } : resolved;
                }
                break;
            }
        }
    }
    return declared;
}

// Tailwind v4 font sizes, in px at the default root font size
const TAILWIND_TEXT_PX: Record<string, number> = {
    'xs': 12, 'sm': 14, 'base': 16, 'lg': 18, 'xl': 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128
};
const TAILWIND_BOLD: Record<string, boolean> = {
    'thin': false, 'extralight': false, 'light': false, 'normal': false, 'medium': false, 'semibold': false, 'bold': true, 'extrabold': true, 'black': true
};
const palette = tailwindColors;

// What text- and bg- utilities take besides colors and font sizes
const TEXT_VALUES = new Set(['left', 'center', 'right', 'justify', 'start', 'end', 'ellipsis', 'clip', 'wrap', 'nowrap', 'balance', 'pretty']);
const BG_VALUES = /^(fixed|local|scroll|auto|cover|contain|none|repeat(-x|-y|-round|-space)?|no-repeat|(left|right|top|bottom|center)(-(top|bottom|left|right))?|(clip|origin)-(border|padding|content)|blend-.+|size-.+|position-.+|\[length:.+\]|\[position:.+\]|\[size:.+\])$/;

// Tailwind utilities that set no colors, as a bare name and as a prefix before `-value`. Color utilities of
// borders, rings, outlines, shadows, decorations, carets, accents and SVG paint change no text or background color.
const UTILITY_NAMES = new Set([
    'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root', 'contents', 'table', 'inline-table',
    'list-item', 'static', 'fixed', 'absolute', 'relative', 'sticky', 'visible', 'collapse', 'isolate', 'container', 'truncate',
    'italic', 'not-italic', 'underline', 'overline', 'line-through', 'no-underline', 'uppercase', 'lowercase', 'capitalize',
    'normal-case', 'antialiased', 'subpixel-antialiased', 'not-sr-only', 'ordinal', 'slashed-zero', 'lining-nums', 'oldstyle-nums',
    'proportional-nums', 'tabular-nums', 'diagonal-fractions', 'stacked-fractions', 'normal-nums', 'group', 'peer', 'transform', 'transition'
]);
const UTILITY_PREFIXES = new Set([
    'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me', 'space-x', 'space-y',
    'gap', 'gap-x', 'gap-y', 'w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'size', 'inset', 'inset-x', 'inset-y', 'top', 'right',
    'bottom', 'left', 'start', 'end', 'z', 'order', 'col', 'row', 'basis', 'flex', 'grow', 'shrink', 'grid', 'grid-cols', 'grid-rows',
    'auto-cols', 'auto-rows', 'justify', 'items', 'content', 'self', 'place', 'rounded', 'border', 'divide', 'shadow', 'inset-shadow',
    'ring', 'inset-ring', 'outline', 'font', 'leading', 'tracking', 'decoration', 'underline-offset', 'indent', 'align', 'whitespace',
    'break', 'hyphens', 'list', 'line-clamp', 'aspect', 'columns', 'object', 'overflow', 'overscroll', 'cursor', 'select',
    'pointer-events', 'resize', 'scroll', 'snap', 'touch', 'will-change', 'transition', 'duration', 'ease', 'delay', 'animate',
    'scale', 'rotate', 'translate', 'skew', 'origin', 'transform', 'perspective', 'backface', 'fill', 'stroke', 'accent', 'caret',
    'appearance', 'box', 'box-decoration', 'float', 'clear', 'isolation', 'table', 'border-spacing', 'caption', 'wrap', 'field-sizing',
    'tab', 'zoom', 'from', 'via', 'to', 'display', 'forced-color-adjust', 'mask', 'text-shadow', 'drop-shadow', 'outline-offset', 'ring-offset', 'opacity'
]);

// A class Tailwind knows; the color and font-size utilities are read before this is asked
function isUtility(name: string): boolean {
    const bare = name.replace(/^-/, '');
    if (UTILITY_NAMES.has(bare) || UTILITY_PREFIXES.has(bare)) return true;
    // An arbitrary property sets what it names, so one that colors the text or background is not known
    const property = /^\[([a-z-]+):.+\]$/.exec(bare)?.[1];
    if (property) return !/color|background|opacity|filter|shadow|blend|scheme/.test(property);
    for (let dash = bare.lastIndexOf('-'); dash > 0; dash = bare.lastIndexOf('-', dash - 1)) {
        if (UTILITY_PREFIXES.has(bare.slice(0, dash))) return true;
    }
    return false;
}

// A Tailwind color name: `white`, `red-500`, or an arbitrary value `[#aaa]`; with an opacity modifier it is semi-transparent
function tailwindColor(name: string): Resolved<Rgb> | 'transparent' | undefined {
    if (name === 'transparent') return 'transparent';
    if (name === 'inherit' || name === 'current') return { uncertain: `the color is ${name}` };
    const [base, opacity] = name.split('/');
    let value: string | undefined;
    const arbitrary = /^\[(.+)\]$/.exec(base)?.[1];
    if (arbitrary) {
        if (arbitrary.startsWith('var(') || arbitrary.startsWith('--')) return { uncertain: `the color ${base} is a CSS variable` };
        value = arbitrary.replace(/^color:/, '').replace(/_/g, ' ');
        // An arbitrary value that is not a color is another utility, such as a font size
        if (!parse(value)) return undefined;
    } else {
        const dash = base.lastIndexOf('-');
        const family = dash === -1 ? palette[base] : palette[base.slice(0, dash)];
        value = typeof family === 'string' ? family : dash === -1 ? undefined : family?.[base.slice(dash + 1)];
        if (value === undefined || ['inherit', 'currentcolor', 'transparent'].includes(value.toLowerCase())) return undefined;
    }
    if (opacity !== undefined && opacity !== '100') return { uncertain: `the color ${name} is semi-transparent` };
    return color(value);
}

// Only classes without a variant: hover:, md: or dark: apply in some states only, and the base state is what is judged
function tailwind(classList: string): Declared {
    const declared: Declared = {};
    const unknown = (name: string) => { declared.unknownClass ??= name; };
    for (const raw of classList.split(/\s+/)) {
        const name = raw.replace(/^!|!$/g, '');
        if (!name || /^[^[]*:/.test(name)) continue;
        if (name === 'hidden' || name === 'invisible' || name === 'sr-only') declared.hidden = true;
        else if (/^opacity-(\d+)$/.test(name) && name !== 'opacity-100') declared.effect = name;
        else if (/^(text-shadow|drop-shadow|mix-blend|blur|brightness|contrast|grayscale|invert|sepia|saturate|hue-rotate|filter|backdrop)(-|$)/.test(name)) declared.effect = name;
        else if (/^(bg-opacity|text-opacity)-/.test(name)) declared.effect = name;
        else if (/^bg-(gradient|linear|radial|conic|\[url)/.test(name) || /^bg-\[(url|linear-gradient|radial-gradient)/.test(name)) {
            declared.background = { uncertain: 'the background is an image or gradient' };
        } else if (name.startsWith('text-')) {
            const value = name.slice('text-'.length);
            const arbitrarySize = /^\[(.+)\]$/.exec(value)?.[1];
            if (TAILWIND_TEXT_PX[value.split('/')[0]] !== undefined) declared.fontSizePx = TAILWIND_TEXT_PX[value.split('/')[0]];
            else if (arbitrarySize && !parse(arbitrarySize.replace(/_/g, ' '))) declared.fontSizePx = px(arbitrarySize);
            else {
                const resolved = tailwindColor(value);
                if (resolved) declared.color = resolved;
                else if (!TEXT_VALUES.has(value)) unknown(name);
            }
        } else if (name.startsWith('bg-')) {
            const value = name.slice('bg-'.length);
            const resolved = tailwindColor(value);
            if (resolved) declared.background = resolved;
            else if (value === 'clip-text') declared.effect = name;
            else if (!BG_VALUES.test(value)) unknown(name);
        } else if (name.startsWith('font-') && TAILWIND_BOLD[name.slice('font-'.length)] !== undefined) {
            declared.bold = TAILWIND_BOLD[name.slice('font-'.length)];
        } else if (/^border(-[0-9]+)?$/.test(name)) {
            declared.border = name !== 'border-0';
        } else if (name.startsWith('border-')) {
            const resolved = tailwindColor(name.slice('border-'.length));
            if (resolved) declared.borderColor = resolved === 'transparent' ? { uncertain: 'the border is transparent' } : resolved;
        } else if (!isUtility(name)) {
            unknown(name);
        }
    }
    return declared;
}
