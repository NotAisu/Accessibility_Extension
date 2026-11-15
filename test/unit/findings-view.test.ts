import * as assert from 'assert';
import type { Finding, Layer } from '../../src/core/analysis';
import { FileFindings, findingsTree, statusSummary, TreeNode } from '../../src/findings-view';

function finding(criterion: string, message: string, layer: Layer = 'check'): Finding {
    return {
        range: { start: 0, end: 1 },
        criteria: [criterion],
        ruleId: 'rule',
        layer,
        severity: layer === 'check' ? 'warning' : 'information',
        message,
        explanation: '',
        helpUrl: 'https://example.org'
    };
}

const file = (overrides: Partial<FileFindings> = {}): FileFindings => ({
    uri: 'file:///app/page.html',
    name: 'page.html',
    findings: [],
    needsReview: [],
    ...overrides
});

const ALL = new Set(['check', 'ai-review', 'needs-review'] as const);

// Label tree as nested arrays: [label, children?]
function labels(nodes: TreeNode[]): unknown[] {
    return nodes.map(node => node.children ? [node.label, labels(node.children)] : node.label);
}

describe('Findings tree', () => {
    it('groups Findings by file and WCAG criterion, in criterion order', () => {
        const tree = findingsTree([file({
            findings: [
                { finding: finding('4.1.2', 'Button has no name'), line: 9 },
                { finding: finding('1.1.1', 'Image has no alt'), line: 3 },
                { finding: finding('1.1.1', 'Alt text is vague', 'ai-review'), line: 5 }
            ]
        })], ALL);

        assert.deepStrictEqual(labels(tree), [
            ['page.html', [
                ['1.1.1 Non-text Content', ['Image has no alt', 'Alt text is vague']],
                ['4.1.2 Name, Role, Value', ['Button has no name']]
            ]]
        ]);
    });

    it('lists Needs Review last and collapsed, one entry per criterion with its reason', () => {
        const tree = findingsTree([file({
            findings: [{ finding: finding('1.1.1', 'Image has no alt'), line: 3 }],
            needsReview: [{ criterion: '1.4.3', reason: 'Text contrast depends on rendered colors.' }]
        })], ALL);

        const children = tree[0].children!;
        const needsReview = children[children.length - 1];
        assert.strictEqual(needsReview.kind, 'needs-review');
        assert.strictEqual(needsReview.collapsed, true);
        assert.deepStrictEqual(labels([needsReview]), [['Needs Review', ['1.4.3 Contrast (Minimum)']]]);
        assert.strictEqual(needsReview.children![0].description, 'Text contrast depends on rendered colors.');
    });

    it('shows only the layers the filters keep, and hides files left empty', () => {
        const files = [
            file({
                findings: [
                    { finding: finding('1.1.1', 'Image has no alt'), line: 3 },
                    { finding: finding('1.1.1', 'Alt text is vague', 'ai-review'), line: 5 }
                ],
                needsReview: [{ criterion: '1.4.3', reason: 'Contrast.' }]
            }),
            file({ uri: 'file:///app/clean.html', name: 'clean.html', needsReview: [{ criterion: '1.4.3', reason: 'Contrast.' }] })
        ];

        assert.deepStrictEqual(labels(findingsTree(files, new Set(['ai-review']))), [
            ['page.html', [['1.1.1 Non-text Content', ['Alt text is vague']]]]
        ]);
        assert.deepStrictEqual(labels(findingsTree(files, new Set(['check', 'needs-review']))), [
            ['page.html', [['1.1.1 Non-text Content', ['Image has no alt']], ['Needs Review', ['1.4.3 Contrast (Minimum)']]]],
            ['clean.html', [['Needs Review', ['1.4.3 Contrast (Minimum)']]]]
        ]);
    });

    it('shows a paused Check with its reason first, whatever the filters, and keeps the last Findings', () => {
        const tree = findingsTree([file({
            findings: [{ finding: finding('1.1.1', 'Image has no alt'), line: 3 }],
            paused: 'Parse error at 2:5: Unexpected token'
        })], new Set(['needs-review']));

        assert.deepStrictEqual(tree[0].children!.map(node => [node.kind, node.label, node.description]), [
            ['paused', 'Check paused', 'Parse error at 2:5: Unexpected token']
        ]);
        assert.deepStrictEqual(labels(findingsTree([file({
            findings: [{ finding: finding('1.1.1', 'Image has no alt'), line: 3 }],
            paused: 'Timed out'
        })], ALL)), [['page.html', ['Check paused', ['1.1.1 Non-text Content', ['Image has no alt']]]]]);
    });

    it('describes each Finding by line and layer, and gives every node a screen reader label', () => {
        const tree = findingsTree([file({
            findings: [
                { finding: finding('1.1.1', 'Image has no alt'), line: 3 },
                { finding: finding('1.1.1', 'Alt text is vague', 'ai-review'), line: 5 }
            ],
            needsReview: [{ criterion: '1.4.3', reason: 'Contrast.' }]
        })], ALL);

        const [criterion, needsReview] = tree[0].children!;
        assert.deepStrictEqual(criterion.children!.map(node => node.description), ['Line 3', 'Line 5 · AI']);
        assert.deepStrictEqual(
            [tree[0], criterion, ...criterion.children!, needsReview, ...needsReview.children!].map(node => node.accessibilityLabel),
            [
                'page.html, 2 Findings, 1 Needs Review',
                'WCAG 1.1.1 Non-text Content, 2 Findings',
                'Check Finding: Image has no alt, line 3',
                'AI Review Finding: Alt text is vague, line 5',
                'Needs Review, 1 criterion the Check cannot decide',
                'Needs Review: WCAG 1.4.3 Contrast (Minimum). Contrast.'
            ]
        );
    });
});

describe('Findings status bar summary', () => {
    it('counts the current file\'s Findings by layer and its Needs Review', () => {
        const summary = statusSummary(file({
            findings: [
                { finding: finding('1.1.1', 'Image has no alt'), line: 3 },
                { finding: finding('4.1.2', 'Button has no name'), line: 4 },
                { finding: finding('1.1.1', 'Alt text is vague', 'ai-review'), line: 5 }
            ],
            needsReview: [{ criterion: '1.4.3', reason: 'Contrast.' }, { criterion: '2.5.8', reason: 'Size.' }]
        }));

        assert.deepStrictEqual(summary, {
            text: '$(warning) 3 Findings',
            tooltip: '2 Check, 1 AI Review. 2 criteria Need Review. Click to show the Findings.',
            accessibilityLabel: 'Accessibility: 3 Findings, 2 Check, 1 AI Review. 2 criteria Need Review.'
        });
    });

    it('says when the current file has no Findings', () => {
        assert.deepStrictEqual(statusSummary(file()), {
            text: '$(pass) No Findings',
            tooltip: 'No Findings. Click to show the Findings.',
            accessibilityLabel: 'Accessibility: No Findings.'
        });
    });

    it('shows a paused Check with its reason instead of a count', () => {
        const summary = statusSummary(file({ findings: [{ finding: finding('1.1.1', 'Image has no alt'), line: 3 }], paused: 'Timed out' }));

        assert.deepStrictEqual(summary, {
            text: '$(debug-pause) Check paused',
            tooltip: 'Timed out. The last Findings stay. Click to show the Findings.',
            accessibilityLabel: 'Accessibility: Check paused: Timed out. The last Findings stay.'
        });
    });
});
