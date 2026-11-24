import * as assert from 'assert';
import { helpBanner, supportsColor, text, type CheckOutput } from '../../src/cli/output';

const SAMPLE_OUTPUT: CheckOutput = {
    schemaVersion: 1,
    files: [{
        file: 'src/Button.tsx',
        languageId: 'typescriptreact',
        status: 'checked',
        findings: [{
            ruleId: 'jsx-a11y-x/alt-text',
            criteria: ['1.1.1'],
            severity: 'warning',
            layer: 'check',
            message: 'img elements must have an alt prop',
            helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
            proof: 'proven',
            range: {
                start: { line: 4, column: 5, offset: 40 },
                end: { line: 4, column: 20, offset: 55 }
            },
            baselined: false
        }],
        needsReview: []
    }],
    summary: {
        files: 1,
        failedFiles: 0,
        findings: 1,
        blocking: 1,
        baselined: 0,
        fixedSinceBaseline: 0,
        needsReview: 0
    }
};

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`);

describe('CLI ASCII banner and TTY formatting', () => {
    it('renders the ASCII help banner cleanly without ANSI codes when color is off', () => {
        const plain = helpBanner('0.2.0', { color: false });
        assert.ok(plain.includes('allyproof v0.2.0'));
        assert.ok(plain.includes('✔'));
        assert.doesNotMatch(plain, ANSI_ESCAPE);

        const styled = helpBanner('0.2.0', { color: true });
        assert.match(styled, ANSI_ESCAPE);
    });

    it('keeps plain text output free of ANSI escapes for CI and piped stdout, and adds polish for TTY', () => {
        const plain = text(SAMPLE_OUTPUT, { color: false });
        assert.doesNotMatch(plain, ANSI_ESCAPE);
        assert.match(plain, /src\/Button\.tsx\n {2}4:5 {2}warning {5}img elements must have an alt prop/);

        const styled = text(SAMPLE_OUTPUT, { color: true });
        assert.match(styled, ANSI_ESCAPE);
        assert.ok(styled.includes('✖'));
    });

    it('respects NO_COLOR and TTY detection', () => {
        assert.strictEqual(supportsColor({ isTTY: true }, {}), true);
        assert.strictEqual(supportsColor({ isTTY: false }, {}), false);
        assert.strictEqual(supportsColor({ isTTY: true }, { NO_COLOR: '1' }), false);
        assert.strictEqual(supportsColor({ isTTY: false }, { FORCE_COLOR: '1' }), true);
    });
});
