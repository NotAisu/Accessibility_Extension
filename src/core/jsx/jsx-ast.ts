import type { TextRange } from '../analysis';
import { addText, type RenderedContent, type SourceElement } from '../needs-review';
import { mappedElement, type ComponentMapping } from '../components';

// What the JSX and Astro engines read from a JSX syntax tree, which both parsers produce for the markup

export interface JsxNode {
    type: string;
    [key: string]: unknown;
}

export interface JsxSource {
    ast: unknown;
    visitorKeys: Record<string, readonly string[] | undefined>;
}

export interface JsxContentOptions {
    /** The nodes whose expression children render text. */
    textParents: readonly string[];
    /** Whether an opening element sets its class or style by other means than a literal attribute. */
    bindsStyle(opening: JsxNode): boolean;
    components?: ComponentMapping;
}

/**
 * Text children (literal or an expression) and intrinsic controls; a component counts as the native element it is
 * mapped to and is otherwise opaque.
 * `element` is the innermost element around the node, also across expressions ({items.map(item => <li>)}).
 */
export function renderedJsxContent(source: JsxSource, options: JsxContentOptions): RenderedContent {
    const content: RenderedContent = { text: false, elements: [] };
    const visit = (node: JsxNode, parent?: JsxNode, element?: SourceElement) => {
        if (node.type === 'JSXText' && typeof node.value === 'string' && node.value.trim()) {
            content.text = true;
            addText(element, node.value);
        }
        if (node.type === 'JSXExpressionContainer' && (node.expression as JsxNode).type !== 'JSXEmptyExpression'
            && options.textParents.includes(parent?.type ?? '')) {
            content.text = true;
            if (!rendersElements(node.expression)) addText(element, true);
        }
        if (node.type === 'JSXElement') {
            const opening = node.openingElement as JsxNode;
            const [start, end] = opening.range as [number, number];
            const written = tagName(opening);
            const attributes = attributesOf(opening);
            const mapped = mappedElement(written, name => attributes.get(name.toLowerCase()), options.components);
            element = { tag: mapped ?? written, attributes, range: { start, end }, parent: element };
            if (mapped) element.component = written;
            if (options.bindsStyle(opening)) element.boundStyle = true;
            content.elements.push(element);
        }
        for (const key of source.visitorKeys[node.type] ?? []) {
            for (const child of [node[key]].flat()) {
                if (child && typeof (child as JsxNode).type === 'string') visit(child as JsxNode, node, element);
            }
        }
    };
    visit(source.ast as JsxNode);
    return content;
}

/** Whether an opening element has a spread attribute, which can set the class or style. */
export function hasSpread(opening: JsxNode): boolean {
    return (opening.attributes as JsxNode[]).some(attribute => attribute.type === 'JSXSpreadAttribute');
}

// UI.Button as written; namespaced names (svg:rect) are left empty
function tagName(element: JsxNode): string {
    const name = (node: JsxNode): string => node.type === 'JSXIdentifier' ? node.name as string
        : node.type === 'JSXMemberExpression' && name(node.object as JsxNode) ? `${name(node.object as JsxNode)}.${name(node.property as JsxNode)}` : '';
    return name(element.name as JsxNode);
}

// Attribute names lowercased (tabIndex → tabindex); spread and namespaced attributes are left out
function attributesOf(element: JsxNode): Map<string, string | true> {
    const attributes = new Map<string, string | true>();
    for (const attribute of element.attributes as JsxNode[]) {
        const name = attribute.name as JsxNode | undefined;
        if (attribute.type === 'JSXSpreadAttribute' || name?.type !== 'JSXIdentifier') continue;
        const lower = (name.name as string).toLowerCase();
        attributes.set(lower, literalValue(lower, attribute.value as JsxNode | null));
    }
    return attributes;
}

/** A string literal, a template literal without expressions, or a style object of literals; otherwise bound (`true`). */
export function literalValue(name: string, value: JsxNode | null): string | true {
    if (value?.type === 'Literal' && typeof value.value === 'string') return value.value;
    const expression = value?.type === 'JSXExpressionContainer' ? value.expression as JsxNode : undefined;
    if (expression?.type === 'Literal' && typeof expression.value === 'string') return expression.value;
    if (expression?.type === 'TemplateLiteral' && (expression.expressions as unknown[]).length === 0) {
        return ((expression.quasis as { value: { cooked: string } }[])[0]).value.cooked;
    }
    if (name === 'style' && expression) return styleObjectCss(expression) ?? true;
    return true;
}

/**
 * The CSS of a style object whose keys and values are all literals; undefined for anything computed.
 * JSX writes inline styles as objects: style={{ color: '#333', backgroundColor: 'white' }}.
 */
export function styleObjectCss(expression: JsxNode): string | undefined {
    if (expression.type !== 'ObjectExpression') return undefined;
    const declarations: string[] = [];
    for (const property of expression.properties as JsxNode[]) {
        if (property.type !== 'Property' || property.computed) return undefined;
        const key = property.key as JsxNode;
        const value = property.value as JsxNode;
        const name = key.type === 'Identifier' ? key.name as string : key.type === 'Literal' ? String(key.value) : undefined;
        if (name === undefined || value.type !== 'Literal' || !['string', 'number'].includes(typeof value.value)) return undefined;
        // React adds px to unitless numbers except for unitless properties such as opacity and fontWeight
        const css = typeof value.value === 'number' && !/^(opacity|fontWeight|zIndex|lineHeight|flex)$/.test(name) ? `${value.value}px` : String(value.value);
        declarations.push(`${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${css}`);
    }
    return declarations.join('; ');
}

/** Whether an expression renders elements rather than text: they then report their own text. */
export function rendersElements(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const { type } = node as JsxNode;
    if (type === 'JSXElement' || type === 'JSXFragment') return true;
    return Object.entries(node).some(([key, value]) => key !== 'parent' && key !== 'loc' && key !== 'range'
        && (Array.isArray(value) ? value.some(rendersElements) : typeof value === 'object' && rendersElements(value)));
}

interface MarkupElement {
    node: JsxNode;
    opening: JsxNode;
    attributes: Map<string, string | true>;
    tag: string;
    hidden: boolean;
    inAttribute: boolean;
    parentLabel?: MarkupElement;
}

/** Findings the shared JSX and Astro trees can decide from the markup. */
export function unnamedMarkup(source: JsxSource, components?: ComponentMapping): { buttons: TextRange[]; labels: TextRange[]; links: TextRange[] } {
    const elements: MarkupElement[] = [];
    const labelsByControl = new Set<string>();
    const visit = (node: JsxNode, inAttribute: boolean, hidden: boolean, parentLabel?: MarkupElement) => {
        if (node.type === 'JSXElement') {
            const opening = node.openingElement as JsxNode;
            const written = tagName(opening);
            const attributes = attributesOf(opening);
            const tag = mappedElement(written, name => attributes.get(name.toLowerCase()), components) ?? written;
            hidden ||= hidesElement(opening, attributes);
            const element = { node, opening, attributes, tag, hidden, inAttribute, parentLabel };
            if (tag === 'button' || tag === 'label' || tag === 'a' && typeof attributes.get('href') === 'string') elements.push(element);
            if (tag === 'label') {
                parentLabel = element;
                const target = attributes.get('htmlfor') ?? attributes.get('for');
                if (typeof target === 'string' && target && couldNameElement(element)) labelsByControl.add(target);
            }
            inAttribute = false;
        } else if (node.type === 'JSXFragment') {
            inAttribute = false;
        } else if (node.type === 'JSXAttribute') {
            inAttribute = true;
            hidden = false;
            parentLabel = undefined;
        }
        for (const key of source.visitorKeys[node.type] ?? []) {
            for (const child of [node[key]].flat()) {
                if (child && typeof (child as JsxNode).type === 'string') visit(child as JsxNode, inAttribute, hidden, parentLabel);
            }
        }
    };
    visit(source.ast as JsxNode, false, false);

    const buttons: TextRange[] = [];
    const labels: TextRange[] = [];
    const links: TextRange[] = [];
    for (const element of elements) {
        const { opening, tag, attributes, hidden, inAttribute, parentLabel } = element;
        if (hidden || inAttribute && opening.selfClosing || couldNameElement(element)) continue;
        const [start, end] = opening.range as [number, number];
        if (tag === 'label') {
            labels.push({ start, end });
            continue;
        }
        if (tag === 'a') {
            links.push({ start, end });
            continue;
        }
        const id = attributes.get('id');
        const labelFor = parentLabel?.attributes.get('htmlfor') ?? parentLabel?.attributes.get('for');
        if (typeof id === 'string' && labelsByControl.has(id)
            || parentLabel && (labelFor === undefined || labelFor === true || labelFor === id) && couldNameElement(parentLabel)) continue;
        buttons.push({ start, end });
    }
    return { buttons, labels, links };
}

const NAME_ATTRS = ['aria-label', 'aria-labelledby', 'title', 'dangerouslysetinnerhtml', 'children'];

function hasNonEmptyAttr(attributes: Map<string, string | true>, name: string): boolean {
    const value = attributes.get(name);
    return value === true || (typeof value === 'string' && value.trim().length > 0);
}

function hasSetContentDirective(opening: JsxNode): boolean {
    return (opening.attributes as JsxNode[]).some(a => {
        const name = a.name as JsxNode | undefined;
        return name?.type === 'JSXNamespacedName'
            && (name.namespace as JsxNode | undefined)?.name === 'set'
            && ['html', 'text'].includes(((name.name as JsxNode | undefined)?.name as string | undefined) ?? '');
    });
}

function hidesElement(opening: JsxNode, attributes = attributesOf(opening)): boolean {
    const hidden = attributes.get('aria-hidden');
    const style = attributes.get('style');
    if (typeof hidden === 'string' && hidden.trim().toLowerCase() === 'true'
        || typeof style === 'string' && /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/i.test(style)) return true;
    return (opening.attributes as JsxNode[]).some(attribute => {
        const name = (attribute.name as JsxNode | undefined)?.name;
        const value = attribute.value as JsxNode | null | undefined;
        const expression = value?.type === 'JSXExpressionContainer' ? value.expression as JsxNode : undefined;
        if (name === 'aria-hidden') return expression?.type === 'Literal' && expression.value === true;
        return name === 'hidden' && (value === null || value?.type === 'Literal'
            || expression?.type === 'Literal' && Boolean(expression.value));
    });
}

/** Whether the reported JSX element or a containing element is statically hidden. */
export function isHiddenAt(source: { getNodeByRangeIndex(index: number): unknown }, offset: number): boolean {
    for (let node = source.getNodeByRangeIndex(offset) as JsxNode | null; node; node = (node.parent as JsxNode | undefined) ?? null) {
        if (node.type === 'JSXElement' && hidesElement(node.openingElement as JsxNode)) return true;
        if (node.type === 'JSXAttribute') break;
    }
    return false;
}

function couldNameElement({ node, opening, attributes }: MarkupElement): boolean {
    return hasSpread(opening)
        || NAME_ATTRS.some(name => hasNonEmptyAttr(attributes, name))
        || hasSetContentDirective(opening) || hasNamedChildren(node);
}

function isEmptyExpression(expression: JsxNode): boolean {
    if (expression.type === 'JSXEmptyExpression') return true;
    if (expression.type !== 'Literal') return false;
    return expression.value === null || typeof expression.value === 'boolean'
        || (typeof expression.value === 'string' && !expression.value.trim());
}

function hasNamedChildren(parent: JsxNode): boolean {
    const children = (parent.children as JsxNode[] | undefined) ?? [];
    for (const child of children) {
        if (child.type === 'JSXText' && typeof child.value === 'string' && child.value.trim()) return true;
        if (child.type === 'JSXExpressionContainer' && !isEmptyExpression(child.expression as JsxNode)) return true;
        if ((child.type === 'JSXFragment' || child.type === 'AstroFragment') && hasNamedChildren(child)) return true;
        if (child.type === 'JSXElement' && childProvidesName(child)) return true;
    }
    return false;
}

function childProvidesName(element: JsxNode): boolean {
    const opening = element.openingElement as JsxNode;
    const attributes = attributesOf(opening);
    if (hidesElement(opening, attributes)) return false;
    if (hasSpread(opening)) return true;
    const tag = tagName(opening);
    // Custom components and <slot> may render text or labelled icons we cannot see statically
    if (!tag || tag === 'slot' || /^[A-Z]/.test(tag) || /[.-]/.test(tag)) return true;
    if (NAME_ATTRS.some(name => hasNonEmptyAttr(attributes, name)) || hasSetContentDirective(opening)) return true;
    if (['img', 'area', 'input'].includes(tag) && hasNonEmptyAttr(attributes, 'alt')) return true;
    if (tag === 'svg') {
        const children = (element.children as JsxNode[] | undefined) ?? [];
        return children.some(c => c.type === 'JSXElement' && tagName(c.openingElement as JsxNode) === 'title' && hasNamedChildren(c));
    }
    return hasNamedChildren(element);
}
