import type { NeedsReview, TextRange } from './analysis';

/** An intrinsic element as written in the source; `attributes` hold literal values, `true` when bound. */
export interface SourceElement {
    tag: string;
    attributes: Map<string, string | true>;
    /** The start tag, or its start where the engine cannot tell its end. */
    range: TextRange;
    /** The enclosing element in the source; a component's children render wherever the component puts them. */
    parent?: SourceElement;
    /** Literal text directly inside the element, trimmed and joined; undefined without any. */
    text?: string;
    /** An expression renders text directly inside the element. */
    boundText?: true;
    /** A class or style is bound to an expression, so the element's colors are not known from source. */
    boundStyle?: true;
}

/** What a document renders that only layout can judge; each engine detects it in its own syntax. */
export interface RenderedContent {
    text: boolean;
    elements: SourceElement[];
    /**
     * The browser's default styles are the only styles besides inline ones: a plain HTML document without
     * stylesheets or scripts. Its default colors and font sizes are then known.
     */
    userAgentStylesOnly?: boolean;
    /** A `<style>` block or the component's own styles declare colors, which any element may get. */
    stylesheetColors?: boolean;
}

// A declaration of a text, background or border color, or of something that changes how colors render
const COLOR_DECLARATION = /(?:^|[{;\s])(?:color|background(?:-color|-image)?|border(?:-[a-z]+)*|opacity|filter|mix-blend-mode|text-shadow)\s*:/i;

/** Whether CSS declares colors. */
export function cssSetsColors(css: string): boolean {
    return COLOR_DECLARATION.test(css.replace(/\/\*[\s\S]*?\*\//g, ''));
}

/** Whether a `<style>` element in a template's source declares colors. */
export function styleBlocksSetColors(source: string): boolean {
    return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].some(([, css]) => cssSetsColors(css));
}

/** Records text directly inside an element: literal text, or an expression that renders some. */
export function addText(element: SourceElement | undefined, text: string | true): void {
    if (!element) return;
    if (text === true) {
        element.boundText = true;
        return;
    }
    const trimmed = text.trim();
    if (trimmed) element.text = element.text === undefined ? trimmed : `${element.text} ${trimmed}`;
}

// The same entries for every language, so the Findings tree reads alike across engines.
// `textContrastDecided`: static contrast decided the contrast of all text, so it needs no review
export function layoutNeedsReview(content: RenderedContent, textContrastDecided = false): NeedsReview[] {
    const entries: NeedsReview[] = [];
    if (content.text && !textContrastDecided) entries.push({ criterion: '1.4.3', reason: 'Text contrast depends on rendered colors.' });
    if (content.elements.some(isControl)) entries.push({ criterion: '2.5.8', reason: 'Target size depends on rendered layout.' });
    return entries;
}

/** Elements a user can point at, as in the HTML engine's selector; `role` and `type` are their literal values. */
export function isControl({ tag, attributes }: SourceElement): boolean {
    const type = attributes.get('type');
    const role = attributes.get('role');
    return (tag === 'a' && attributes.has('href'))
        || ['button', 'select', 'textarea', 'summary'].includes(tag)
        || (tag === 'input' && type !== 'hidden')
        || attributes.has('tabindex')
        || role === 'button' || role === 'link';
}
