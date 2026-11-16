import { addText, type RenderedContent, type SourceElement } from '../needs-review';

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
}

/**
 * Text children (literal or an expression) and intrinsic controls; components are opaque until Component Mapping.
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
            element = { tag: tagName(opening), attributes: attributesOf(opening), range: { start, end }, parent: element };
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

function tagName(element: JsxNode): string {
    const name = element.name as JsxNode;
    return name.type === 'JSXIdentifier' ? name.name as string : '';
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
