import { Linter } from 'eslint/universal';
import astro from 'eslint-plugin-astro';
import * as astroParser from 'astro-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { eslintOffsetAt, lintSkippingCrashedRules } from '../eslint';
import { styleBlocksSetColors } from '../needs-review';
import { emptyButtons, hasSpread, renderedJsxContent, type JsxNode } from '../jsx/jsx-ast';
import { buttonNameFinding, withOwnRules } from '../own-rules';
import { jsxA11ySettings, RULE_CRITERIA, RULE_OPTIONS } from '../jsx/engine';
import type { ComponentMapping } from '../components';

// The Astro engine as one chunk, loaded on the first Astro document.
// eslint-plugin-astro wraps the eslint-plugin-jsx-a11y-x rules for the template, so the rules, their
// criteria and options are those of the JSX engine.

const PREFIX = 'astro/jsx-a11y/';

type RuleModule = { meta?: { docs?: { description?: string; extensionRule?: { url?: string } } } };
const plugin = astro as unknown as { rules: Record<string, RuleModule> };

// The bundled config only; the workspace's own ESLint config is never loaded.
// The frontmatter is TypeScript and is parsed by @typescript-eslint/parser.
function config(skip: Set<string>, components: ComponentMapping | undefined): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        .filter(rule => !skip.has(PREFIX + rule))
        .map(rule => [PREFIX + rule, ['warn', ...RULE_OPTIONS[rule]]]));
    return [{
        files: ['**/*.astro'],
        plugins: { astro: astro as unknown as NonNullable<Linter.Config['plugins']>[string] },
        languageOptions: {
            parser: astroParser,
            ecmaVersion: 'latest',
            sourceType: 'module',
            // A parser object, not a name: astro-eslint-parser would require() a name at lint time
            parserOptions: { parser: tsParser }
        },
        settings: jsxA11ySettings(components),
        rules
    }];
}

const linter = new Linter({ configType: 'flat' });

export function checkAstro(text: string, components?: ComponentMapping): AnalysisResult {
    const toOffset = eslintOffsetAt(text);
    const findings: Finding[] = [];
    for (const message of lintSkippingCrashedRules(linter, text, 'document.astro', skip => config(skip, components))) {
        // Unparseable code must not read as a clean file
        if (message.fatal) throw new ParseError(`${message.line}:${message.column}`, message.message);
        const rule = message.ruleId?.startsWith(PREFIX) ? message.ruleId.slice(PREFIX.length) : undefined;
        if (!rule || !RULE_CRITERIA[rule]) continue;
        const start = toOffset(message.line, message.column);
        const end = message.endLine && message.endColumn ? toOffset(message.endLine, message.endColumn) : start;
        const docs = plugin.rules[`jsx-a11y/${rule}`]?.meta?.docs;
        findings.push({
            range: { start, end },
            criteria: RULE_CRITERIA[rule],
            ruleId: message.ruleId!,
            layer: 'check',
            severity: 'warning',
            message: message.message,
            explanation: message.message,
            helpUrl: docs?.extensionRule?.url ?? `https://github.com/es-tooling/eslint-plugin-jsx-a11y-x/tree/HEAD/docs/rules/${rule}.md`
        });
    }
    const source = linter.getSourceCode();
    for (const range of emptyButtons(source, components)) findings.push(buttonNameFinding(range));
    // <script> and <style> bodies are raw text that renders nothing. class:list and spread attributes can set the class or style
    const content = renderedJsxContent(source, {
        textParents: ['JSXElement', 'JSXFragment', 'AstroFragment'],
        bindsStyle: opening => hasSpread(opening) || (opening.attributes as JsxNode[]).some(a => (a.name as JsxNode | undefined)?.type === 'JSXNamespacedName'),
        components
    });
    content.stylesheetColors = styleBlocksSetColors(text);
    return withOwnRules(findings, content);
}
