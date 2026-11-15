import { Linter } from 'eslint/universal';
import * as htmlPlugin from '@html-eslint/eslint-plugin';
import * as htmlParser from '@html-eslint/parser';
import type { Finding } from '../analysis';
import { lineOffsets } from '../offsets';

// @html-eslint rules whose failure maps to a WCAG 2.2 A/AA criterion, primary criterion first.
// require-img-alt, require-input-label, require-title, no-invalid-role and no-aria-hidden-on-focusable
// are left out: axe-core covers them and they misfire on ACT passed cases (title/role=none images,
// doc-* roles, disabled or hidden inputs, <title> outside <head>).
const RULE_CRITERIA: Record<string, string[]> = {
    'no-abstract-roles': ['4.1.2'],
    'no-aria-hidden-body': ['1.3.1', '4.1.2'],
    'no-nested-interactive': ['4.1.2'],
    'no-non-scalable-viewport': ['1.4.4'],
    'no-positive-tabindex': ['2.4.3'],
    'require-frame-title': ['4.1.2'],
    'require-lang': ['3.1.1'],
    'require-li-container': ['1.3.1']
};

const PREFIX = '@html-eslint/';

type RuleModule = { meta?: { docs?: { description?: string; url?: string } } };
const plugin = htmlPlugin as unknown as { rules: Record<string, RuleModule> };

// The bundled config only; the workspace's own ESLint config is never loaded
const CONFIG: Linter.Config[] = [{
    files: ['**/*.html'],
    plugins: { '@html-eslint': htmlPlugin as unknown as NonNullable<Linter.Config['plugins']>[string] },
    languageOptions: { parser: htmlParser as unknown as Linter.Parser },
    rules: Object.fromEntries(Object.keys(RULE_CRITERIA).map(rule => [PREFIX + rule, 'warn']))
}];

const linter = new Linter({ configType: 'flat' });

export function checkHtmlWithEslint(text: string): Finding[] {
    const offsets = lineOffsets(text);
    const toOffset = (line: number, column: number) => Math.min(offsets[line - 1] + column - 1, text.length);
    const findings: Finding[] = [];
    for (const message of linter.verify(text, CONFIG, 'document.html')) {
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
            helpUrl: docs?.url ?? `https://html-eslint.org/docs/rules/${rule}`
        });
    }
    return findings;
}
