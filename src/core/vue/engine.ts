import { Linter } from 'eslint/universal';
import vueA11y from 'eslint-plugin-vuejs-accessibility';
import * as vueParser from 'vue-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { eslintOffsetAt, lintSkippingCrashedRules } from '../eslint';
import { addText, styleBlocksSetColors, type RenderedContent, type SourceElement } from '../needs-review';
import { withOwnRules } from '../own-rules';
import { mappedElement, writtenNames, type ComponentMapping } from '../components';

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
                const renamed = mapped ?? (/[A-Z]/.test(written) ? `component-${written.toLowerCase()}` : undefined);
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
// jsx-a11y's label-has-associated-control asserts. aria-role ignores custom components whose `role` is a prop.
export const RULE_OPTIONS: Record<string, unknown[]> = {
    'aria-role': [{ ignoreNonDOM: true }],
    'label-has-for': [{ required: { some: ['nesting', 'id'] } }]
};

// The bundled config only; the workspace's own ESLint config is never loaded.
// Rules otherwise run with their default options, as the plugin's recommended config does.
function config(skip: Set<string>, components: ComponentMapping | undefined): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        .filter(rule => !skip.has(PREFIX + rule))
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

export function checkVue(text: string, components?: ComponentMapping): AnalysisResult {
    const toOffset = eslintOffsetAt(text);
    const findings: Finding[] = [];
    for (const message of lintSkippingCrashedRules(linter, text, 'document.vue', skip => config(skip, components))) {
        // Unparseable code must not read as a clean file
        if (message.fatal) throw new ParseError(`${message.line}:${message.column}`, message.message);
        const rule = message.ruleId?.startsWith(PREFIX) ? message.ruleId.slice(PREFIX.length) : undefined;
        if (!rule || !RULE_CRITERIA[rule]) continue;
        const start = toOffset(message.line, message.column);
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
    const content = renderedContent(ast.templateBody);
    content.stylesheetColors = styleBlocksSetColors(text);
    return withOwnRules(findings, content, { inputPurpose: true });
}

interface VueNode {
    type: string;
    [key: string]: unknown;
}

// Text and mustaches in the template and intrinsic controls; a component counts as the native element it is mapped
// to and is otherwise opaque
function renderedContent(template: VueNode | undefined): RenderedContent {
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
            (node.children as VueNode[]).forEach(child => visit(child, element));
        }
    };
    // The <template> element itself renders nothing; its children do
    for (const child of (template?.children ?? []) as VueNode[]) visit(child);
    return content;
}

// A value only for a static attribute; a binding (:href, v-bind:role) counts as present
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
            attributes.set((argument.name as string).toLowerCase(), true);
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
