import * as assert from 'assert';
import type { Finding } from '../../src/core/analysis';
import { diagnosticMessage, HOVER_COMMANDS, learnMarkdown } from '../../src/learn-hover';

const finding = (overrides: Partial<Finding> = {}): Finding => ({
    range: { start: 10, end: 30 },
    criteria: ['1.1.1'],
    ruleId: 'jsx-a11y-x/alt-text',
    layer: 'check',
    severity: 'warning',
    message: 'img elements must have an alt prop',
    explanation: 'Engine explanation',
    helpUrl: 'https://github.com/example/alt-text.md',
    ...overrides
});

const target = { uri: 'file:///app/Card.tsx', version: 3, aiReview: true };

// Markdown outside fenced code blocks and code spans
const prose = (markdown: string) => markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const commandsOf = (markdown: string) => [...markdown.matchAll(/\]\(command:([^)?]+)/g)].map(match => match[1]);

describe('learn hover', () => {
    it("explains the rule with bad and good code in the document's own framework", () => {
        const markdown = learnMarkdown(finding(), 'typescriptreact', target);

        assert.match(markdown, /^\*\*Images need a text alternative\*\*/);
        assert.match(markdown, /Screen reader users hear nothing/);
        assert.match(markdown, /\*\*How to fix:\*\* Add an alt attribute/);
        assert.ok(markdown.includes('```jsx\n<img src="chart.png" />\n```'), markdown);
        assert.ok(markdown.includes('```jsx\n<img src="chart.png" alt="Sales rose 20% in May" />\n```'), markdown);
    });

    it('shows Vue code in a Vue file and Angular code in an Angular template', () => {
        const ruleId = 'click-events-have-key-events';
        const vue = learnMarkdown(finding({ ruleId: `vuejs-accessibility/${ruleId}` }), 'vue', target);
        assert.ok(vue.includes('```vue\n<template>\n  <div @click="openMenu">Menu</div>\n</template>\n```'), vue);

        const angular = learnMarkdown(finding({ ruleId: `@angular-eslint/template/${ruleId}` }), 'angular', target);
        assert.ok(angular.includes('<div (click)="openMenu()">Menu</div>'), angular);
    });

    it('names the file a page-level snippet belongs in', () => {
        const markdown = learnMarkdown(finding({ ruleId: 'svelte/a11y_missing_attribute' }), 'svelte', target);
        assert.ok(!markdown.includes('index.html'));

        const page = learnMarkdown(finding({ ruleId: '@html-eslint/require-lang', criteria: ['3.1.1'] }), 'vue', target);
        assert.match(page, /Bad, in `index\.html`:/);
    });

    it('links the WCAG Understanding page, the ACT rule and the rule help', () => {
        const markdown = learnMarkdown(finding(), 'javascriptreact', target);

        assert.ok(markdown.includes('](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content)'));
        assert.ok(markdown.includes('](https://www.w3.org/WAI/standards-guidelines/act/rules/23a2a8/)'));
        assert.ok(markdown.includes('](https://github.com/example/alt-text.md)'));
    });

    it("shows a contrast Finding's own ratio and required value", () => {
        const contrast = finding({
            ruleId: 'allyproof/text-contrast',
            criteria: ['1.4.3'],
            message: 'Text contrast is 2.85:1, below the required 4.5:1',
            explanation: 'The text color #999999 on the background #ffffff has a contrast ratio of 2.85:1; WCAG 1.4.3 requires 4.5:1.'
        });
        const markdown = learnMarkdown(contrast, 'html', target);

        assert.ok(prose(markdown).includes('2\\.85:1'), markdown);
        assert.ok(prose(markdown).includes('requires 4\\.5:1'), markdown);
    });

    it('offers only the allowlisted commands, with the Finding as arguments', () => {
        const markdown = learnMarkdown(finding(), 'typescriptreact', target);

        assert.deepStrictEqual(commandsOf(markdown), ['allyproof.ignoreFinding', 'allyproof.disableRule', 'allyproof.startAIReview']);
        assert.ok(commandsOf(markdown).every(command => HOVER_COMMANDS.includes(command)));
        const ignore = /\(command:allyproof\.ignoreFinding\?([^)]+)\)/.exec(markdown)![1];
        assert.deepStrictEqual(JSON.parse(decodeURIComponent(ignore)), ['file:///app/Card.tsx', 'jsx-a11y-x/alt-text', 10, 3]);
        const disable = /\(command:allyproof\.disableRule\?([^)]+)\)/.exec(markdown)![1];
        assert.deepStrictEqual(JSON.parse(decodeURIComponent(disable)), ['jsx-a11y-x/alt-text']);
    });

    it('leaves out Start AI Review where the AI Review is unavailable', () => {
        const markdown = learnMarkdown(finding(), 'html', { ...target, aiReview: false });
        assert.deepStrictEqual(commandsOf(markdown), ['allyproof.ignoreFinding', 'allyproof.disableRule']);
    });

    it('stays plain Markdown: no HTML outside code, no images', () => {
        for (const ruleId of ['image-alt', 'svelte/a11y_figcaption_index', 'allyproof/non-text-contrast', 'unknown-rule']) {
            const markdown = learnMarkdown(finding({ ruleId, explanation: 'Use <label> or `aria-label`' }), 'svelte', target);
            assert.doesNotMatch(prose(markdown), /(?<!\\)</, `${ruleId}: raw HTML\n${markdown}`);
            assert.doesNotMatch(markdown, /!\[/, `${ruleId}: image`);
        }
    });

    it('explains a rule without docs with the engine text', () => {
        const markdown = learnMarkdown(finding({ ruleId: 'unknown-rule', message: 'Some problem' }), 'html', target);
        assert.match(markdown, /^\*\*Some problem\*\*/);
        assert.match(markdown, /Engine explanation/);
        assert.deepStrictEqual(commandsOf(markdown), ['allyproof.ignoreFinding', 'allyproof.disableRule', 'allyproof.startAIReview']);
    });

    it('keeps the diagnostic message on one line', () => {
        const message = diagnosticMessage(finding({ message: 'First line\n  second line', criteria: ['1.1.1', '4.1.2'] }));
        assert.strictEqual(message, 'First line second line (WCAG 1.1.1, 4.1.2)');
    });
});
