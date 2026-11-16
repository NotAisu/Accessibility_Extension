// JSX writes inline styles as objects: style={{ color: '#333', backgroundColor: 'white' }}

interface JsxNode {
    type: string;
    [key: string]: unknown;
}

/** The CSS of a style object whose keys and values are all literals; undefined for anything computed. */
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
