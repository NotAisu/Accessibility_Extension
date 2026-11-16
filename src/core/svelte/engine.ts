import { compile, type AST, type Warning } from 'svelte/compiler';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { addText, cssSetsColors, type RenderedContent, type SourceElement } from '../needs-review';
import { withOwnRules } from '../own-rules';

// The Svelte engine as one chunk, loaded on the first Svelte document.

// Svelte compiler a11y warnings whose failure maps to a WCAG 2.2 A/AA criterion, primary criterion first,
// mapped like the JSX engine's equivalent rules. Best-practice warnings without a WCAG
// failure (a11y_accesskey, a11y_autofocus, a11y_hidden, a11y_no_noninteractive_tabindex,
// a11y_no_redundant_roles) are left out.
export const WARNING_CRITERIA: Record<string, string[]> = {
    'a11y_aria_activedescendant_has_tabindex': ['2.1.1'],
    'a11y_aria_attributes': ['4.1.2'],
    'a11y_autocomplete_valid': ['1.3.5'],
    'a11y_click_events_have_key_events': ['2.1.1'],
    'a11y_consider_explicit_label': ['2.4.4', '4.1.2'],
    'a11y_distracting_elements': ['2.2.2'],
    'a11y_figcaption_index': ['1.3.1'],
    'a11y_figcaption_parent': ['1.3.1'],
    'a11y_img_redundant_alt': ['1.1.1'],
    'a11y_incorrect_aria_attribute_type': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_boolean': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_id': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_idlist': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_integer': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_token': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_tokenlist': ['4.1.2'],
    'a11y_incorrect_aria_attribute_type_tristate': ['4.1.2'],
    'a11y_interactive_supports_focus': ['2.1.1'],
    'a11y_invalid_attribute': ['2.1.1'],
    'a11y_label_has_associated_control': ['1.3.1', '4.1.2'],
    'a11y_media_has_caption': ['1.2.2'],
    'a11y_misplaced_role': ['4.1.2'],
    'a11y_misplaced_scope': ['1.3.1'],
    'a11y_missing_content': ['2.4.6', '1.3.1'],
    'a11y_mouse_events_have_key_events': ['2.1.1'],
    'a11y_no_abstract_role': ['4.1.2'],
    'a11y_no_interactive_element_to_noninteractive_role': ['4.1.2'],
    'a11y_no_noninteractive_element_interactions': ['4.1.2'],
    'a11y_no_noninteractive_element_to_interactive_role': ['4.1.2'],
    'a11y_no_static_element_interactions': ['4.1.2'],
    'a11y_positive_tabindex': ['2.4.3'],
    'a11y_role_has_required_aria_props': ['4.1.2'],
    'a11y_role_supports_aria_props': ['4.1.2'],
    'a11y_role_supports_aria_props_implicit': ['4.1.2'],
    'a11y_unknown_aria_attribute': ['4.1.2'],
    'a11y_unknown_role': ['4.1.2']
};

// a11y_missing_attribute covers several elements; its message names the element
export const MISSING_ATTRIBUTE_CRITERIA: Record<string, string[]> = {
    'a': ['2.1.1'],
    'area': ['1.1.1'],
    'html': ['3.1.1'],
    'iframe': ['4.1.2'],
    'img': ['1.1.1'],
    'input': ['1.1.1'],
    'object': ['1.1.1']
};

/** The criteria a warning fails, or undefined when it has no WCAG failure. */
export function criteriaOf(code: string, message: string): string[] | undefined {
    if (code !== 'a11y_missing_attribute') return WARNING_CRITERIA[code];
    const element = /^`<([a-z]+)/.exec(message)?.[1];
    return element ? MISSING_ATTRIBUTE_CRITERIA[element] : undefined;
}

const PREFIX = 'svelte/';

export function checkSvelte(text: string): AnalysisResult {
    const { warnings, ast } = compileComponent(text);
    const findings: Finding[] = [];
    for (const warning of warnings) {
        const criteria = criteriaOf(warning.code, warning.message);
        if (!criteria || !warning.position) continue;
        // The message ends in a link to the warning's documentation
        const [message, helpUrl] = splitLink(warning.message);
        findings.push({
            range: { start: warning.position[0], end: warning.position[1] },
            criteria,
            ruleId: PREFIX + warning.code,
            layer: 'check',
            severity: 'warning',
            message,
            explanation: message,
            helpUrl: helpUrl ?? `https://svelte.dev/e/${warning.code}`
        });
    }
    const content = renderedContent(ast);
    content.stylesheetColors = ast.css !== null && cssSetsColors(ast.css.content.styles);
    return withOwnRules(findings, content);
}

// Nodes that render children inside something not known from this file
const OPAQUE = ['Component', 'SvelteComponent', 'SvelteElement', 'SvelteSelf', 'SlotElement'];

interface SvelteNode {
    type: string;
    [key: string]: unknown;
}

// Text and expression tags in the markup and intrinsic controls; components are opaque until Component Mapping.
// Only fragments are walked, so attribute values, the script and the style never count as rendered text
function renderedContent(ast: AST.Root): RenderedContent {
    const content: RenderedContent = { text: false, elements: [] };
    const visit = (node: SvelteNode, parent?: SourceElement) => {
        if (node.type === 'Text' && typeof node.data === 'string' && node.data.trim()) {
            content.text = true;
            addText(parent, node.data);
        }
        if (node.type === 'ExpressionTag' || node.type === 'HtmlTag') {
            content.text = true;
            addText(parent, true);
        }
        if (node.type === 'RegularElement' || OPAQUE.includes(node.type)) {
            // The AST spans the whole element, so its range is the `<name` that opens it
            const start = node.start as number;
            const element: SourceElement = { tag: node.name as string, attributes: attributesOf(node), range: { start, end: start + 1 + (node.name as string).length }, parent };
            // class: and style: directives and spread attributes change the class or style beyond its literal value
            if ((node.attributes as SvelteNode[]).some(a => ['ClassDirective', 'StyleDirective', 'SpreadAttribute'].includes(a.type))) element.boundStyle = true;
            // Components and dynamic elements are opaque until Component Mapping, but their children are known to be inside them
            if (node.type === 'RegularElement') content.elements.push(element);
            parent = element;
        }
        if (node.type === 'Fragment') (node.nodes as SvelteNode[]).forEach(child => visit(child, parent));
        // Blocks and elements hold their children in fragments (fragment, consequent, body, then, …)
        for (const value of Object.values(node)) {
            if (value && typeof value === 'object' && (value as SvelteNode).type === 'Fragment') visit(value as SvelteNode, parent);
        }
    };
    visit(ast.fragment as unknown as SvelteNode);
    return content;
}

// A value only when it is plain text; an expression or a directive counts as present
function attributesOf(element: SvelteNode): Map<string, string | true> {
    const attributes = new Map<string, string | true>();
    for (const attribute of element.attributes as SvelteNode[]) {
        if (attribute.type !== 'Attribute') continue;
        const value = attribute.value;
        const [only] = Array.isArray(value) ? value as SvelteNode[] : [];
        const literal = Array.isArray(value) && value.length === 1 && only.type === 'Text' ? only.data as string : true;
        attributes.set((attribute.name as string).toLowerCase(), literal);
    }
    return attributes;
}

function compileComponent(text: string): { warnings: Warning[]; ast: AST.Root } {
    try {
        // generate: false analyses the component without producing code; nothing in it runs
        const { warnings, ast } = compile(text, { generate: false, modernAst: true }) as { warnings: Warning[]; ast: AST.Root };
        return { warnings, ast };
    } catch (error) {
        // Invalid components must not read as clean files; the compiler names every such error CompileError
        if ((error as Error).name !== 'CompileError') throw error;
        const { start, message } = error as { start?: { line: number; column: number }; message: string };
        throw new ParseError(`Parse error${start ? ` at ${start.line}:${start.column + 1}` : ''}: ${splitLink(message)[0]}`);
    }
}

function splitLink(message: string): [string, string | undefined] {
    const index = message.lastIndexOf('\nhttps://');
    return index === -1 ? [message, undefined] : [message.slice(0, index), message.slice(index + 1)];
}
