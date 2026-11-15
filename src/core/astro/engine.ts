import { Linter } from 'eslint/universal';
import astro from 'eslint-plugin-astro';
import * as astroParser from 'astro-eslint-parser';
import * as tsParser from '@typescript-eslint/parser';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { lineOffsets } from '../offsets';
import { isControl, layoutNeedsReview, RenderedContent } from '../needs-review';
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
        if (message.fatal) throw new ParseError(`Parse error at ${message.line}:${message.column}: ${message.message}`);
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
    return { findings, needsReview: layoutNeedsReview(renderedContent(linter.getSourceCode())) };
}

interface AstroNode {
    type: string;
    [key: string]: unknown;
}

// Text and expressions in the template and intrinsic controls; <script> and <style> bodies are raw text that
// renders nothing, and components are opaque until Component Mapping
function renderedContent(source: { ast: unknown; visitorKeys: Record<string, readonly string[] | undefined> }): RenderedContent {
    const content = { text: false, controls: false };
    const visit = (node: AstroNode, parent?: AstroNode) => {
        if (node.type === 'JSXText' && typeof node.value === 'string' && node.value.trim()) content.text = true;
        if (node.type === 'JSXExpressionContainer' && (node.expression as AstroNode).type !== 'JSXEmptyExpression'
            && ['JSXElement', 'JSXFragment', 'AstroFragment'].includes(parent?.type ?? '')) content.text = true;
        if (node.type === 'JSXOpeningElement' && isControl(tagName(node), attributesOf(node))) content.controls = true;
        for (const key of source.visitorKeys[node.type] ?? []) {
            for (const child of [node[key]].flat()) {
                if (child && typeof (child as AstroNode).type === 'string') visit(child as AstroNode, node);
            }
        }
    };
    visit(source.ast as AstroNode);
    return content;
}

function tagName(element: AstroNode): string {
    const name = element.name as AstroNode;
    return name.type === 'JSXIdentifier' ? name.name as string : '';
}

// A value only for a string literal; an expression ({href}, href={url}) counts as present
function attributesOf(element: AstroNode): Map<string, string | true> {
    const attributes = new Map<string, string | true>();
    for (const attribute of element.attributes as AstroNode[]) {
        const name = attribute.name as AstroNode | undefined;
        if (attribute.type === 'JSXSpreadAttribute' || name?.type !== 'JSXIdentifier') continue;
        const value = attribute.value as AstroNode | null;
        const literal = value?.type === 'Literal' && typeof value.value === 'string' ? value.value : true;
        attributes.set((name.name as string).toLowerCase(), literal);
    }
    return attributes;
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
