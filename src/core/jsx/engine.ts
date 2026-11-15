import { Linter } from 'eslint/universal';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { lineOffsets } from '../offsets';
import { isControl, layoutNeedsReview, RenderedContent } from '../needs-review';

// The JSX/TSX engine as one chunk, loaded on the first React document.

// eslint-plugin-jsx-a11y-x rules whose failure maps to a WCAG 2.2 A/AA criterion, primary criterion first.
// Best-practice rules without a WCAG failure (no-access-key, no-autofocus, no-noninteractive-tabindex,
// no-redundant-roles, prefer-tag-over-role) are left out.
// control-has-associated-label is off by default upstream: it needs options to tell controls from wrappers.
export const RULE_CRITERIA: Record<string, string[]> = {
    'alt-text': ['1.1.1'],
    'anchor-ambiguous-text': ['2.4.4'],
    'anchor-has-content': ['2.4.4', '4.1.2'],
    'anchor-is-valid': ['2.1.1'],
    'aria-activedescendant-has-tabindex': ['2.1.1'],
    'aria-props': ['4.1.2'],
    'aria-proptypes': ['4.1.2'],
    'aria-role': ['4.1.2'],
    'aria-unsupported-elements': ['4.1.2'],
    'autocomplete-valid': ['1.3.5'],
    'click-events-have-key-events': ['2.1.1'],
    'heading-has-content': ['2.4.6', '1.3.1'],
    'html-has-lang': ['3.1.1'],
    'iframe-has-title': ['4.1.2'],
    'img-redundant-alt': ['1.1.1'],
    'interactive-supports-focus': ['2.1.1'],
    'label-has-associated-control': ['1.3.1', '4.1.2'],
    'lang': ['3.1.1'],
    'media-has-caption': ['1.2.2'],
    'mouse-events-have-key-events': ['2.1.1'],
    'no-aria-hidden-on-focusable': ['4.1.2'],
    'no-distracting-elements': ['2.2.2'],
    'no-interactive-element-to-noninteractive-role': ['4.1.2'],
    'no-noninteractive-element-interactions': ['4.1.2'],
    'no-noninteractive-element-to-interactive-role': ['4.1.2'],
    'no-static-element-interactions': ['4.1.2'],
    'role-has-required-aria-props': ['4.1.2'],
    'role-supports-aria-props': ['4.1.2'],
    'scope': ['1.3.1'],
    'tabindex-no-positive': ['2.4.3']
};

const PREFIX = 'jsx-a11y-x/';

type RuleModule = { meta?: { docs?: { description?: string; url?: string } } };
const plugin = jsxA11y as unknown as {
    rules: Record<string, RuleModule>;
    configs: { recommended: { rules: Record<string, Linter.RuleEntry> } };
};

// label-has-associated-control's default, spelled out as its rule tests do
const SPELLED_OUT_DEFAULTS: Record<string, unknown[]> = {
    'label-has-associated-control': [{ assert: 'either' }]
};

// Options from the plugin's recommended config, which its rule tests exercise; rules it turns off
// run with their default options
export const RULE_OPTIONS: Record<string, unknown[]> = Object.fromEntries(Object.keys(RULE_CRITERIA).map(rule => {
    const entry = plugin.configs.recommended.rules[PREFIX + rule];
    return [rule, SPELLED_OUT_DEFAULTS[rule] ?? (Array.isArray(entry) ? entry.slice(1) : [])];
}));

// The bundled config only; the workspace's own ESLint config is never loaded
function config(skip: Set<string>): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        .filter(rule => !skip.has(PREFIX + rule))
        .map(rule => [PREFIX + rule, ['warn', ...RULE_OPTIONS[rule]]]));
    const plugins = { 'jsx-a11y-x': jsxA11y as unknown as NonNullable<Linter.Config['plugins']>[string] };
    return [
        {
            files: ['**/*.jsx'],
            plugins,
            languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
            rules
        },
        {
            files: ['**/*.tsx'],
            plugins,
            languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
            rules
        }
    ];
}

const linter = new Linter({ configType: 'flat' });

/** Plain JSX is parsed by espree, TypeScript only for `.tsx` (`typescript: true`). */
export function checkJsx(text: string, typescript: boolean): AnalysisResult {
    const offsets = lineOffsets(text);
    const toOffset = (line: number, column: number) => Math.min(offsets[line - 1] + column - 1, text.length);
    const findings: Finding[] = [];
    for (const message of verify(text, typescript ? 'document.tsx' : 'document.jsx')) {
        // Unparseable code must not read as a clean file
        if (message.fatal) throw new ParseError(`Parse error at ${message.line}:${message.column}: ${message.message}`);
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
            helpUrl: docs?.url ?? `https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/tree/HEAD/docs/rules/${rule}.md`
        });
    }
    return { findings, needsReview: layoutNeedsReview(renderedContent(linter.getSourceCode())) };
}

interface JsxNode {
    type: string;
    [key: string]: unknown;
}

// Text children (literal or an expression) and intrinsic controls; components are opaque until Component Mapping
function renderedContent(source: { ast: unknown; visitorKeys: Record<string, readonly string[] | undefined> }): RenderedContent {
    const content = { text: false, controls: false };
    const visit = (node: JsxNode, parent?: JsxNode) => {
        if (node.type === 'JSXText' && typeof node.value === 'string' && node.value.trim()) content.text = true;
        if (node.type === 'JSXExpressionContainer' && (node.expression as JsxNode).type !== 'JSXEmptyExpression'
            && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) content.text = true;
        if (node.type === 'JSXOpeningElement' && isControl(tagName(node), attributesOf(node))) content.controls = true;
        for (const key of source.visitorKeys[node.type] ?? []) {
            for (const child of [node[key]].flat()) {
                if (child && typeof (child as JsxNode).type === 'string') visit(child as JsxNode, node);
            }
        }
    };
    visit(source.ast as JsxNode);
    return content;
}

function tagName(element: JsxNode): string {
    const name = element.name as JsxNode;
    return name.type === 'JSXIdentifier' ? name.name as string : '';
}

// Attribute names lowercased (tabIndex → tabindex); a value only when it is a string literal
function attributesOf(element: JsxNode): Map<string, string | true> {
    const attributes = new Map<string, string | true>();
    for (const attribute of element.attributes as JsxNode[]) {
        if (attribute.type !== 'JSXAttribute' || (attribute.name as JsxNode).type !== 'JSXIdentifier') continue;
        const value = attribute.value as JsxNode | null;
        const literal = value?.type === 'Literal' && typeof value.value === 'string' ? value.value : true;
        attributes.set(((attribute.name as JsxNode).name as string).toLowerCase(), literal);
    }
    return attributes;
}

// A rule that throws on unusual code (lang without a value) would cost every other rule's
// Findings, so the document is linted again without it
function verify(text: string, filename: string): Linter.LintMessage[] {
    const skip = new Set<string>();
    for (;;) {
        try {
            return linter.verify(text, config(skip), filename);
        } catch (error) {
            const ruleId = (error as { ruleId?: unknown }).ruleId;
            if (typeof ruleId !== 'string' || skip.has(ruleId)) throw error;
            skip.add(ruleId);
        }
    }
}
