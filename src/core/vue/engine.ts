import { Linter } from 'eslint/universal';
import { dom as ariaDom } from 'aria-query';
import vueA11y from 'eslint-plugin-vuejs-accessibility';
import * as vueParser from 'vue-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { eslintOffsetAt, lintSkippingCrashedRules } from '../eslint';
import { addText, styleBlocksSetColors, type RenderedContent, type SourceElement } from '../needs-review';
import { withOwnRules } from '../own-rules';
import { mappedElement, writtenNames, type ComponentMapping } from '../components';
import { inlineDisplayNone, inlineVisibilityHidden } from '../inline-visibility';
import { styleObjectCss } from '../jsx/jsx-ast';

// The Vue engine as one chunk, loaded on the first Vue document.

// eslint-plugin-vuejs-accessibility rules whose failure maps to a WCAG 2.2 A/AA criterion, primary criterion first.
// Best-practice rules without a WCAG failure (no-access-key, no-autofocus, no-onchange, no-redundant-roles)
// are left out.
export const RULE_CRITERIA: Record<string, string[]> = {
    'alt-text': ['1.1.1'],
    'anchor-has-content': ['2.4.4', '4.1.2'],
    'aria-props': ['4.1.2'],
    'aria-role': ['4.1.2'],
    'aria-unsupported-elements': ['4.1.2'],
    'click-events-have-key-events': ['2.1.1'],
    'form-control-has-label': ['4.1.2', '1.3.1'],
    'heading-has-content': ['2.4.6', '1.3.1'],
    'iframe-has-title': ['4.1.2'],
    'interactive-supports-focus': ['2.1.1'],
    'label-has-for': ['1.3.1', '4.1.2'],
    'media-has-caption': ['1.2.2'],
    'mouse-events-have-key-events': ['2.1.1'],
    'no-aria-hidden-on-focusable': ['4.1.2'],
    'no-distracting-elements': ['2.2.2'],
    'no-role-presentation-on-focusable': ['4.1.2'],
    'no-static-element-interactions': ['4.1.2'],
    'role-has-required-aria-props': ['4.1.2'],
    'tabindex-no-positive': ['2.4.3']
};

const PREFIX = 'vuejs-accessibility/';

type RuleModule = { meta?: { docs?: { description?: string; url?: string } } };
const plugin = vueA11y as unknown as { rules: Record<string, RuleModule> };

// The plugin has no Component Mapping of its own, so the parser renames each mapped component in the syntax tree
// to the native element it renders before any rule reads it; ranges stay those of the source.
// The plugin kebab-cases names, so an unmapped <Select> or <Textarea> component would read as the native element;
// it is renamed to a custom element, whose rendering the rules do not guess.
function mappingParser(components: ComponentMapping | undefined): Linter.Parser {
    return {
        ...vueParser,
        parseForESLint(code: string, options: unknown) {
            const result = vueParser.parseForESLint(code, options as Parameters<typeof vueParser.parseForESLint>[1]);
            const visit = (node: VueNode) => {
                if (node.type !== 'VElement') return;
                const written = node.rawName as string;
                const mapped = mappedElement(written, name => staticAttribute(node, name), components, true);
                const renamed = mapped ?? (node.namespace === vueParser.AST.NS.HTML && /[A-Z]/.test(written)
                    ? `component-${written.toLowerCase()}` : undefined);
                if (renamed) {
                    writtenNames.set(node, written);
                    node.name = node.rawName = renamed;
                }
                (node.children as VueNode[]).forEach(visit);
            };
            ((result.ast as { templateBody?: VueNode }).templateBody?.children as VueNode[] | undefined)?.forEach(visit);
            return result;
        }
    };
}

function staticAttribute(element: VueNode, name: string): string | true | undefined {
    const attribute = (element.startTag as { attributes: VueNode[] }).attributes
        .find(a => !a.directive && ((a.key as VueNode).name as string) === name);
    if (!attribute) return undefined;
    return (attribute.value as { value: string } | null)?.value ?? true;
}

// label-has-for's default asks for nesting and an id at once; either one labels the control (H44), as
// jsx-a11y's label-has-associated-control asserts.
export const RULE_OPTIONS: Record<string, unknown[]> = {
    'label-has-for': [{ required: { some: ['nesting', 'id'] } }]
};

// The bundled config only; the workspace's own ESLint config is never loaded.
// Rules otherwise run with their default options, as the plugin's recommended config does.
function config(skip: Set<string>, components: ComponentMapping | undefined): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        // The upstream iframe rule only checks title, even on a hidden iframe or one named through ARIA.
        .filter(rule => rule !== 'iframe-has-title' && !skip.has(PREFIX + rule))
        .map(rule => [PREFIX + rule, ['warn', ...RULE_OPTIONS[rule] ?? []]]));
    return [{
        files: ['**/*.vue'],
        plugins: { 'vuejs-accessibility': vueA11y as unknown as NonNullable<Linter.Config['plugins']>[string] },
        languageOptions: {
            parser: mappingParser(components),
            ecmaVersion: 'latest',
            sourceType: 'module',
            // Parser objects, not names: vue-eslint-parser would require() a name at lint time.
            // Without a lang the script and the template expressions are parsed by espree.
            parserOptions: { parser: { ts: tsParser, tsx: tsParser }, ecmaFeatures: { jsx: true } }
        },
        rules
    }];
}

const linter = new Linter({ configType: 'flat' });

function componentRoleOffsets(template: VueNode | undefined): Set<number> {
    const offsets = new Set<number>();
    const visit = (node: VueNode): void => {
        if (node.type !== 'VElement') return;
        const tag = node.rawName as string;
        if (node.namespace === vueParser.AST.NS.HTML && !ariaDom.has(tag)) {
            const startTag = node.startTag as { attributes: { range: [number, number] }[] };
            for (const attribute of startTag.attributes) offsets.add(attribute.range[0]);
        }
        (node.children as VueNode[]).forEach(visit);
    };
    if (template) visit(template);
    return offsets;
}

export function checkVue(text: string, components?: ComponentMapping): AnalysisResult {
    const toOffset = eslintOffsetAt(text);
    const findings: Finding[] = [];
    const messages = lintSkippingCrashedRules(linter, text, 'document.vue', skip => config(skip, components));
    let componentRoles: Set<number> | undefined;
    for (const message of messages) {
        // Unparseable code must not read as a clean file
        if (message.fatal) throw new ParseError(`${message.line}:${message.column}`, message.message);
        const rule = message.ruleId?.startsWith(PREFIX) ? message.ruleId.slice(PREFIX.length) : undefined;
        if (!rule || !RULE_CRITERIA[rule]) continue;
        const start = toOffset(message.line, message.column);
        // The plugin's ignoreNonDOM also ignores SVG and MathML, whose roles still apply.
        if (rule === 'aria-role') {
            const ast = linter.getSourceCode().ast as { templateBody?: VueNode };
            componentRoles ??= componentRoleOffsets(ast.templateBody);
            if (componentRoles.has(start)) continue;
        }
        const end = message.endLine && message.endColumn ? toOffset(message.endLine, message.endColumn) : start;
        const docs = plugin.rules[rule]?.meta?.docs;
        findings.push({
            range: { start, end },
            criteria: RULE_CRITERIA[rule],
            ruleId: message.ruleId!,
            layer: 'check',
            severity: 'warning',
            message: message.message,
            explanation: docs?.description ?? message.message,
            helpUrl: docs?.url ?? `https://vue-a11y.github.io/eslint-plugin-vuejs-accessibility/rules/${rule}.html`
        });
    }
    const ast = linter.getSourceCode().ast as { templateBody?: VueNode };
    const content = renderedContent(ast.templateBody, findings);
    content.stylesheetColors = styleBlocksSetColors(text);
    return withOwnRules(findings, content, { inputPurpose: true });
}

interface VueNode {
    type: string;
    [key: string]: unknown;
}

// Text and mustaches in the template and intrinsic controls; a component counts as the native element it is mapped
// to and is otherwise opaque
function renderedContent(template: VueNode | undefined, findings: Finding[]): RenderedContent {
    const content: RenderedContent = { text: false, elements: [] };
    const visit = (node: VueNode, parent?: SourceElement) => {
        if (node.type === 'VText' && typeof node.value === 'string' && node.value.trim()) {
            content.text = true;
            addText(parent, node.value);
        }
        if (node.type === 'VExpressionContainer') {
            content.text = true;
            addText(parent, true);
        }
        if (node.type === 'VElement') {
            const [start, end] = (node.startTag as { range: [number, number] }).range;
            // Components keep their written name (MyButton), elements are lowercase
            const tag = (node.rawName as string | undefined) ?? node.name as string;
            const element: SourceElement = { tag: /^[A-Z]/.test(tag) ? tag : node.name as string, attributes: attributesOf(node), range: { start, end }, parent };
            const component = writtenNames.get(node);
            if (component) element.component = component;
            if (bindsClassOrStyle(node) || hasVShow(node)) element.boundStyle = true;
            content.elements.push(element);
            if (element.tag === 'iframe' && needsIframeName(element) && !hasUncertainIframeMarkup(node)) {
                findings.push({
                    range: element.range,
                    criteria: RULE_CRITERIA['iframe-has-title'],
                    ruleId: PREFIX + 'iframe-has-title',
                    layer: 'check',
                    severity: 'warning',
                    message: 'Iframes need an accessible name.',
                    explanation: 'Give the frame a title that tells users what it contains before entering it.',
                    helpUrl: 'https://www.w3.org/WAI/standards-guidelines/act/rules/cae760/proposed/'
                });
            }
            (node.children as VueNode[]).forEach(child => visit(child, element));
        }
    };
    // The <template> element itself renders nothing; its children do
    for (const child of (template?.children ?? []) as VueNode[]) visit(child);
    return content;
}

function hasUncertainIframeMarkup(node: VueNode): boolean {
    for (let current: VueNode | undefined = node; current?.type === 'VElement'; current = current.parent as VueNode | undefined) {
        const attributes = (current.startTag as { attributes: VueNode[] }).attributes;
        for (const attribute of attributes.filter(attribute => attribute.directive)) {
            const key = attribute.key as VueNode;
            const name = (key.name as VueNode).name;
            const argument = key.argument as VueNode | null;
            if (name === 'bind' && argument?.type !== 'VIdentifier') return true;
            const expression = (attribute.value as VueNode | null)?.expression as VueNode | null;
            if ((name === 'show' || name === 'if') && literalCondition(expression) === false) return true;
        }
    }
    return false;
}

function literalCondition(expression: VueNode | null | undefined): boolean | undefined {
    if (expression?.type === 'Literal') return Boolean(expression.value);
    if (expression?.type === 'UnaryExpression' && expression.operator === '!') {
        const value = literalCondition(expression.argument as VueNode);
        if (value !== undefined) return !value;
    }
    return undefined;
}

function needsIframeName(element: SourceElement): boolean {
    const { attributes } = element;
    const hasContent = attributes.get('src') || attributes.get('srcdoc');
    if (!hasContent || ['title', 'aria-label', 'aria-labelledby'].some(name => {
        const value = attributes.get(name);
        return value === true || Boolean(value?.trim());
    })) return false;
    const tabIndex = attributes.get('tabindex');
    const role = attributes.get('role');
    if (tabIndex === true || typeof tabIndex === 'string' && /^-\d+$/.test(tabIndex.trim()) && Number(tabIndex) < 0
        || role === true || typeof role === 'string' && /^(?:none|presentation)$/i.test(role.trim())) return false;

    let visibilityHidden: boolean | undefined;
    for (let ancestor: SourceElement | undefined = element; ancestor; ancestor = ancestor.parent) {
        const attributes = ancestor.attributes;
        const ariaHidden = attributes.get('aria-hidden');
        const style = attributes.get('style');
        if (attributes.has('hidden') || attributes.has('inert') || ariaHidden === true
            || typeof ariaHidden === 'string' && ariaHidden.trim().toLowerCase() === 'true'
            || inlineDisplayNone(style)) return false;
        visibilityHidden ??= inlineVisibilityHidden(style);
    }
    return !visibilityHidden;
}

// A dynamic binding counts as present. Resolve literal bindings needed to tell whether an iframe is exposed.
function attributesOf(element: VueNode): Map<string, string | true> {
    const attributes = new Map<string, string | true>();
    for (const attribute of (element.startTag as { attributes: VueNode[] }).attributes) {
        const key = attribute.key as VueNode;
        if (!attribute.directive) {
            const value = attribute.value as { value: string } | null;
            attributes.set((key.name as string).toLowerCase(), value ? value.value : true);
            continue;
        }
        const argument = key.argument as VueNode | null;
        if ((key.name as VueNode).name === 'bind' && argument?.type === 'VIdentifier') {
            const name = (argument.name as string).toLowerCase();
            const expression = (attribute.value as VueNode | null)?.expression as VueNode | undefined;
            if (name === 'style' && expression) {
                const css = expression.type === 'Literal' && typeof expression.value === 'string' ? expression.value : styleObjectCss(expression);
                attributes.set(name, css ?? true);
            } else if (['src', 'srcdoc', 'aria-hidden'].includes(name) && expression?.type === 'Literal') {
                const value = expression.value;
                if (value === null) attributes.delete(name);
                else if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') attributes.set(name, String(value));
                else attributes.set(name, true);
            } else {
                attributes.set(name, true);
            }
        }
    }
    return attributes;
}

// :class, :style and v-bind="object" set the class or style beyond its literal value
function bindsClassOrStyle(element: VueNode): boolean {
    return directives(element).some(({ name, argument }) =>
        name === 'bind' && (!argument || (argument.type === 'VIdentifier' && ['class', 'style'].includes(argument.name as string))));
}

// v-show only toggles display, which sets no color. Whether the text shows depends on an expression, though, so
// its contrast is not judged: the element counts as having a bound style, which makes its colors uncertain
function hasVShow(element: VueNode): boolean {
    return directives(element).some(({ name }) => name === 'show');
}

function directives(element: VueNode): { name: unknown; argument: VueNode | null }[] {
    return (element.startTag as { attributes: VueNode[] }).attributes.filter(attribute => attribute.directive).map(attribute => {
        const key = attribute.key as VueNode;
        return { name: (key.name as VueNode).name, argument: key.argument as VueNode | null };
    });
}
