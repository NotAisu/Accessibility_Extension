import { Linter } from 'eslint/universal';
import angularTemplate from '@angular-eslint/eslint-plugin-template';
import * as templateParser from '@angular-eslint/template-parser';
import ts from 'typescript';
import { AnalysisResult, Finding, ParseError } from '../analysis';
import { lineOffsets } from '../offsets';
import { addText, type RenderedContent, type SourceElement } from '../needs-review';
import { withOwnRules } from '../own-rules';

// The Angular engine as one chunk, loaded on the first Angular template or component file.

// @angular-eslint/eslint-plugin-template rules whose failure maps to a WCAG 2.2 A/AA criterion, primary
// criterion first. Best-practice rules without a WCAG failure (button-has-type, no-autofocus) are left out.
export const RULE_CRITERIA: Record<string, string[]> = {
    'alt-text': ['1.1.1'],
    'click-events-have-key-events': ['2.1.1'],
    // Per element, see ELEMENTS_CONTENT_CRITERIA
    'elements-content': ['4.1.2'],
    'interactive-supports-focus': ['2.1.1'],
    'label-has-associated-control': ['1.3.1', '4.1.2'],
    'mouse-events-have-key-events': ['2.1.1'],
    'no-distracting-elements': ['2.2.2'],
    'no-positive-tabindex': ['2.4.3'],
    'role-has-required-aria': ['4.1.2'],
    'table-scope': ['1.3.1'],
    'valid-aria': ['4.1.2']
};

// elements-content covers several elements; its message names the element
export const ELEMENTS_CONTENT_CRITERIA: Record<string, string[]> = {
    'a': ['2.4.4', '4.1.2'],
    'button': ['4.1.2'],
    'h1': ['2.4.6', '1.3.1'],
    'h2': ['2.4.6', '1.3.1'],
    'h3': ['2.4.6', '1.3.1'],
    'h4': ['2.4.6', '1.3.1'],
    'h5': ['2.4.6', '1.3.1'],
    'h6': ['2.4.6', '1.3.1']
};

/** The criteria a rule's message fails, or undefined when the rule has no WCAG failure. */
export function criteriaOf(rule: string, message: string): string[] | undefined {
    if (rule !== 'elements-content') return RULE_CRITERIA[rule];
    const element = /^<([a-z0-9]+)>/i.exec(message)?.[1].toLowerCase();
    return element ? ELEMENTS_CONTENT_CRITERIA[element] : undefined;
}

const PREFIX = '@angular-eslint/template/';

type RuleModule = { meta?: { docs?: { description?: string; url?: string } } };
const plugin = angularTemplate as unknown as { rules: Record<string, RuleModule> };

// The bundled config only; the workspace's own ESLint config is never loaded.
// Rules run with their default options.
function config(skip: Set<string>): Linter.Config[] {
    const rules: Linter.RulesRecord = Object.fromEntries(Object.keys(RULE_CRITERIA)
        .filter(rule => !skip.has(PREFIX + rule))
        .map(rule => [PREFIX + rule, 'warn']));
    return [{
        files: ['**/*.html'],
        plugins: { '@angular-eslint/template': angularTemplate as unknown as NonNullable<Linter.Config['plugins']>[string] },
        languageOptions: { parser: templateParser },
        rules
    }];
}

const linter = new Linter({ configType: 'flat' });

/** An external component template. */
export function checkAngularTemplate(text: string): AnalysisResult {
    const { findings, content } = checkTemplate(text, 0);
    return withOwnRules(findings, content, { inputPurpose: true });
}

/** The inline `template` strings of the `@Component` decorators in a TypeScript file. */
export function checkAngularComponents(text: string): AnalysisResult {
    const findings: Finding[] = [];
    const content: RenderedContent = { text: false, elements: [] };
    for (const template of inlineTemplates(text)) {
        const checked = checkTemplate(template.text, template.start);
        findings.push(...checked.findings);
        content.text ||= checked.content.text;
        content.elements.push(...checked.content.elements);
    }
    return withOwnRules(findings, content, { inputPurpose: true });
}

// Ranges are offsets into the template text plus `base`, its start in the checked document
function checkTemplate(text: string, base: number): { findings: Finding[]; content: RenderedContent } {
    const offsets = lineOffsets(text);
    const toOffset = (line: number, column: number) => base + Math.min(offsets[line - 1] + column - 1, text.length);
    const findings: Finding[] = [];
    const messages = verify(text);
    const facts = messages.some(message => message.fatal) ? undefined : templateFacts(linter.getSourceCode().ast, base);
    for (const message of messages) {
        // Unparseable code must not read as a clean file
        if (message.fatal) {
            const start = toOffset(message.line, message.column);
            throw new ParseError(`Parse error at offset ${start}: ${message.message}`);
        }
        const rule = message.ruleId?.startsWith(PREFIX) ? message.ruleId.slice(PREFIX.length) : undefined;
        const criteria = rule && criteriaOf(rule, message.message);
        if (!rule || !criteria) continue;
        const start = toOffset(message.line, message.column);
        // Its selector's :has() also matches every ancestor of an element with the mouse event
        if (rule === 'mouse-events-have-key-events' && !facts!.boundEvents.get(start - base)?.has(/^`(\w+)`/.exec(message.message)?.[1] ?? '')) continue;
        const end = message.endLine && message.endColumn ? toOffset(message.endLine, message.endColumn) : start;
        const docs = plugin.rules[rule]?.meta?.docs;
        findings.push({
            range: { start, end },
            criteria,
            ruleId: message.ruleId!,
            layer: 'check',
            severity: 'warning',
            message: message.message,
            explanation: docs?.description?.replace(/^\[Accessibility\] /, '') ?? message.message,
            helpUrl: docs?.url ?? `https://github.com/angular-eslint/angular-eslint/blob/main/packages/eslint-plugin-template/docs/rules/${rule}.md`
        });
    }
    return { findings, content: facts!.content };
}

interface InlineTemplate {
    text: string;
    /** Offset of the template's first character in the component file. */
    start: number;
}

// The raw literal text is linted, so template offsets map one to one onto the file; components with a
// templateUrl are checked in their template file
function inlineTemplates(text: string): InlineTemplate[] {
    const source = ts.createSourceFile('component.ts', text, ts.ScriptTarget.Latest, true);
    // Unparseable code must not read as a clean file; the parser recovers, and may lose a template doing so.
    // parseDiagnostics is internal but the only way to get syntax errors without a program
    const [syntaxError] = (source as unknown as { parseDiagnostics: ts.DiagnosticWithLocation[] }).parseDiagnostics;
    if (syntaxError) {
        throw new ParseError(`Parse error at offset ${syntaxError.start}: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, ' ')}`);
    }
    const templates: InlineTemplate[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isDecorator(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)
            && node.expression.expression.text === 'Component') {
            const metadata = node.expression.arguments[0];
            if (metadata && ts.isObjectLiteralExpression(metadata)) {
                const template = metadata.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'template');
                const initializer = template && (template as ts.PropertyAssignment).initializer;
                if (initializer && (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer))) {
                    const start = initializer.getStart(source) + 1;
                    templates.push({ text: text.slice(start, initializer.getEnd() - 1), start });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return templates;
}

interface TemplateNode {
    [key: string]: unknown;
}

// The template parser keeps Angular's binding type: 2 for [class.x], 3 for [style.x]
const BOUND_STYLE_TYPES = [2, 3];

interface BoundInput {
    name: string;
    __originalType?: number;
}

interface TemplateFacts {
    content: RenderedContent;
    /** The events each element binds itself, by the offset of its start tag. */
    boundEvents: Map<number, Set<string>>;
}

// Text, interpolations and intrinsic controls; components are opaque until Component Mapping
function templateFacts(ast: unknown, base: number): TemplateFacts {
    const content: RenderedContent = { text: false, elements: [] };
    const boundEvents = new Map<number, Set<string>>();
    const visit = (node: TemplateNode, parent?: SourceElement) => {
        if (node.type === 'Text' && typeof node.value === 'string' && node.value.trim()) {
            content.text = true;
            addText(parent, node.value);
        }
        if (node.type === 'BoundText') {
            content.text = true;
            addText(parent, true);
        }
        if (node.type === 'Element') {
            const start = (node.sourceSpan as { start: { offset: number } }).start.offset;
            const end = (node.startSourceSpan as { end: { offset: number } }).end.offset;
            const element: SourceElement = { tag: node.name as string, attributes: attributesOf(node), range: { start: base + start, end: base + end }, parent };
            // [class], [class.x], [style.x], [ngClass] and [ngStyle] change the class or style beyond its literal value
            if ((node.inputs as BoundInput[]).some(input => BOUND_STYLE_TYPES.includes(input.__originalType ?? -1)
                || ['class', 'style', 'ngclass', 'ngstyle'].includes(input.name.toLowerCase()))) element.boundStyle = true;
            content.elements.push(element);
            boundEvents.set(start, new Set((node.outputs as { name: string }[]).map(output => output.name)));
            parent = element;
        }
        // Elements, ng-template and control flow blocks keep what they render in children; blocks keep
        // their branches, cases and @empty, @placeholder, @loading and @error parts beside them
        for (const key of ['children', 'branches', 'groups', 'cases', 'empty', 'placeholder', 'loading', 'error']) {
            for (const child of [node[key]].flat()) {
                if (child && typeof child === 'object') visit(child as TemplateNode, parent);
            }
        }
    };
    (ast as { templateNodes: TemplateNode[] }).templateNodes.forEach(node => visit(node));
    return { content, boundEvents };
}

// A value only for a static attribute; a binding ([href], [attr.role]) counts as present
function attributesOf(element: TemplateNode): Map<string, string | true> {
    const attributes = new Map<string, string | true>();
    for (const attribute of element.attributes as { name: string; value: string }[]) {
        attributes.set(attribute.name.toLowerCase(), attribute.value);
    }
    for (const input of element.inputs as { name: string }[]) {
        attributes.set(input.name.replace(/^attr\./, '').toLowerCase(), true);
    }
    return attributes;
}

// A rule that throws on unusual code would cost every other rule's Findings, so the document is
// linted again without it
function verify(text: string): Linter.LintMessage[] {
    const skip = new Set<string>();
    for (;;) {
        try {
            return linter.verify(text, config(skip), 'template.html');
        } catch (error) {
            const ruleId = (error as { ruleId?: unknown }).ruleId;
            if (typeof ruleId !== 'string' || skip.has(ruleId)) throw error;
            skip.add(ruleId);
        }
    }
}
