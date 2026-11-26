import { Linter } from 'eslint/universal';
import astro from 'eslint-plugin-astro';
import * as astroParser from 'astro-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { eslintOffsetAt, lintSkippingCrashedRules } from '../eslint';
import { styleBlocksSetColors } from '../needs-review';
import { hasNamedContentAt, hasSpread, isHiddenAt, renderedJsxContent, type JsxNode } from '../jsx/jsx-ast';
import { withOwnRules } from '../own-rules';
import { addMarkupFindings, jsxA11ySettings, RULE_CRITERIA, RULE_OPTIONS } from '../jsx/engine';
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
        if ((rule === 'alt-text' || rule === 'anchor-has-content') && isHiddenAt(linter.getSourceCode(), start)) continue;
        if (rule === 'label-has-associated-control' && message.message === 'A form label must have accessible text.'
            && hasNamedContentAt(linter.getSourceCode(), start)) continue;
        if (rule === 'aria-unsupported-elements' && isAriaHiddenOnScript(linter.getSourceCode(), start, message.message)) continue;
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
    addMarkupFindings(findings, source, PREFIX, components);
    // <script> and <style> bodies are raw text that renders nothing. class:list and spread attributes can set the class or style
    const content = renderedJsxContent(source, {
        textParents: ['JSXElement', 'JSXFragment', 'AstroFragment'],
        bindsStyle: opening => hasSpread(opening) || (opening.attributes as JsxNode[]).some(a => (a.name as JsxNode | undefined)?.type === 'JSXNamespacedName'),
        components
    });
    content.stylesheetColors = styleBlocksSetColors(text);
    return withOwnRules(findings, content);
}

// Starlight adds aria-hidden="true" to inline <script> inside display:contents containers to work around
// Safari/VoiceOver reading script text (https://bugs.webkit.org/show_bug.cgi?id=283645,
// https://github.com/withastro/starlight/pull/2633). eslint-plugin-astro's aria-unsupported-elements
// (https://github.com/ota-meshi/eslint-plugin-astro) flags it; no upstream issue filed yet.
function isAriaHiddenOnScript(source: { getNodeByRangeIndex(index: number): unknown }, offset: number, message: string): boolean {
    if (!message.includes("'aria-hidden'")) return false;
    let node = source.getNodeByRangeIndex(offset) as JsxNode | null;
    while (node && node.type !== 'JSXOpeningElement' && node.type !== 'JSXElement') {
        node = (node.parent as JsxNode | undefined) ?? null;
    }
    const opening = node?.type === 'JSXElement' ? node.openingElement as JsxNode : node;
    const name = opening?.name as JsxNode | undefined;
    return name?.type === 'JSXIdentifier' && name.name === 'script';
}
