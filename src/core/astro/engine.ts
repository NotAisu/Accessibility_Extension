import { Linter } from 'eslint/universal';
import astro from 'eslint-plugin-astro';
import * as astroParser from 'astro-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { lineOffsets } from '../offsets';
import { styleBlocksSetColors } from '../needs-review';
import { hasSpread, renderedJsxContent, type JsxNode } from '../jsx/jsx-ast';
import { withOwnRules } from '../own-rules';
import { RULE_CRITERIA, RULE_OPTIONS } from '../jsx/engine';

// The Astro engine as one chunk, loaded on the first Astro document.
// eslint-plugin-astro wraps the eslint-plugin-jsx-a11y-x rules for the template, so the rules, their
// criteria and options are those of the JSX engine.

const PREFIX = 'astro/jsx-a11y/';

type RuleModule = { meta?: { docs?: { description?: string; extensionRule?: { url?: string } } } };
const plugin = astro as unknown as { rules: Record<string, RuleModule> };

// The bundled config only; the workspace's own ESLint config is never loaded.
// The frontmatter is TypeScript and is parsed by @typescript-eslint/parser.
function config(skip: Set<string>): Linter.Config[] {
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
        rules
    }];
}

const linter = new Linter({ configType: 'flat' });

export function checkAstro(text: string): AnalysisResult {
    const offsets = lineOffsets(text);
    const toOffset = (line: number, column: number) => Math.min(offsets[line - 1] + column - 1, text.length);
    const findings: Finding[] = [];
    for (const message of verify(text)) {
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
    // <script> and <style> bodies are raw text that renders nothing. class:list and spread attributes can set the class or style
    const content = renderedJsxContent(linter.getSourceCode(), {
        textParents: ['JSXElement', 'JSXFragment', 'AstroFragment'],
        bindsStyle: opening => hasSpread(opening) || (opening.attributes as JsxNode[]).some(a => (a.name as JsxNode | undefined)?.type === 'JSXNamespacedName')
    });
    content.stylesheetColors = styleBlocksSetColors(text);
    return withOwnRules(findings, content);
}

// A rule that throws on unusual code would cost every other rule's Findings, so the document is
// linted again without it
function verify(text: string): Linter.LintMessage[] {
    const skip = new Set<string>();
    for (;;) {
        try {
            return linter.verify(text, config(skip), 'document.astro');
        } catch (error) {
            const ruleId = (error as { ruleId?: unknown }).ruleId;
            if (typeof ruleId !== 'string' || skip.has(ruleId)) throw error;
            skip.add(ruleId);
        }
    }
}
