import { Linter } from 'eslint/universal';
import vueA11y from 'eslint-plugin-vuejs-accessibility';
import * as vueParser from 'vue-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { Finding, ParseError } from '../analysis';
import { lineOffsets } from '../offsets';

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

// The bundled config only; the workspace's own ESLint config is never loaded.
// Rules run with their default options, as the plugin's recommended config does.
function config(skip: Set<string>): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        .filter(rule => !skip.has(PREFIX + rule))
        .map(rule => [PREFIX + rule, 'warn']));
    return [{
        files: ['**/*.vue'],
        plugins: { 'vuejs-accessibility': vueA11y as unknown as NonNullable<Linter.Config['plugins']>[string] },
        languageOptions: {
            parser: vueParser,
            ecmaVersion: 'latest',
            sourceType: 'module',
            // Parser objects, not names: vue-eslint-parser would require() a name at lint time.
            // Without a lang the script and the template expressions are parsed by espree.
            parserOptions: { parser: { ts: tsParser } }
        },
        rules
    }];
}

const linter = new Linter({ configType: 'flat' });

export function checkVue(text: string): Finding[] {
    const offsets = lineOffsets(text);
    const toOffset = (line: number, column: number) => Math.min(offsets[line - 1] + column - 1, text.length);
    const findings: Finding[] = [];
    for (const message of verify(text)) {
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
            helpUrl: docs?.url ?? `https://vue-a11y.github.io/eslint-plugin-vuejs-accessibility/rules/${rule}.html`
        });
    }
    return findings;
}

// A rule that throws on unusual code would cost every other rule's Findings, so the document is
// linted again without it
function verify(text: string): Linter.LintMessage[] {
    const skip = new Set<string>();
    for (;;) {
        try {
            return linter.verify(text, config(skip), 'document.vue');
        } catch (error) {
            const ruleId = (error as { ruleId?: unknown }).ruleId;
            if (typeof ruleId !== 'string' || skip.has(ruleId)) throw error;
            skip.add(ruleId);
        }
    }
}
