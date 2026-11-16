import { Linter } from 'eslint/universal';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { lineOffsets } from '../offsets';
import { hasSpread, renderedJsxContent } from './jsx-ast';
import { withOwnRules } from '../own-rules';
import type { ComponentMapping } from '../components';

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

/** The plugin's own settings for Component Mapping, read by every rule through its element type. */
export function jsxA11ySettings(components: ComponentMapping | undefined): Linter.Config['settings'] {
    return { 'jsx-a11y-x': { components: components?.components ?? {}, polymorphicPropName: components?.polymorphicPropName } };
}

// The bundled config only; the workspace's own ESLint config is never loaded
function config(skip: Set<string>, components: ComponentMapping | undefined): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        .filter(rule => !skip.has(PREFIX + rule))
        .map(rule => [PREFIX + rule, ['warn', ...RULE_OPTIONS[rule]]]));
    const plugins = { 'jsx-a11y-x': jsxA11y as unknown as NonNullable<Linter.Config['plugins']>[string] };
    const settings = jsxA11ySettings(components);
    return [
        {
            files: ['**/*.jsx'],
            plugins,
            languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
            settings,
            rules
        },
        {
            files: ['**/*.tsx'],
            plugins,
            languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
            settings,
            rules
        }
    ];
}

const linter = new Linter({ configType: 'flat' });

/** Plain JSX is parsed by espree, TypeScript only for `.tsx` (`typescript: true`). */
export function checkJsx(text: string, typescript: boolean, components?: ComponentMapping): AnalysisResult {
    const offsets = lineOffsets(text);
    const toOffset = (line: number, column: number) => Math.min(offsets[line - 1] + column - 1, text.length);
    const findings: Finding[] = [];
    for (const message of verify(text, typescript ? 'document.tsx' : 'document.jsx', components)) {
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
            helpUrl: docs?.url ?? `https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/tree/HEAD/docs/rules/${rule}.md`
        });
    }
    // Spread attributes can set the class or style
    return withOwnRules(findings, renderedJsxContent(linter.getSourceCode(), { textParents: ['JSXElement', 'JSXFragment'], bindsStyle: hasSpread, components }));
}

// A rule that throws on unusual code (lang without a value) would cost every other rule's
// Findings, so the document is linted again without it
function verify(text: string, filename: string, components: ComponentMapping | undefined): Linter.LintMessage[] {
    const skip = new Set<string>();
    for (;;) {
        try {
            return linter.verify(text, config(skip, components), filename);
        } catch (error) {
            const ruleId = (error as { ruleId?: unknown }).ruleId;
            if (typeof ruleId !== 'string' || skip.has(ruleId)) throw error;
            skip.add(ruleId);
        }
    }
}
