import * as assert from 'assert';
import { bundledPackageDirs, isAllowedLicense } from '../../scripts/third-party-notices';

describe('third-party notices', () => {
    it('allows permissive licenses and SPDX expressions made of them', () => {
        assert.ok(isAllowedLicense('MIT'));
        assert.ok(isAllowedLicense('(MIT OR GPL-3.0-only)'));
        assert.ok(isAllowedLicense('MIT AND ISC'));
    });

    it('rejects unknown and copyleft licenses', () => {
        assert.ok(!isAllowedLicense('GPL-3.0-only'));
        assert.ok(!isAllowedLicense('MIT AND GPL-3.0-only'));
        assert.ok(!isAllowedLicense('UNKNOWN'));
        assert.ok(!isAllowedLicense('GPL-3.0-only AND (MIT OR ISC)'));
    });

    it('reads nested brackets with AND binding tighter than OR', () => {
        assert.ok(isAllowedLicense('(MIT OR (Apache-2.0 AND BSD-3-Clause))'));
        assert.ok(isAllowedLicense('((MIT))'));
        assert.ok(isAllowedLicense('GPL-3.0-only AND LGPL-2.1-only OR MIT'));
        assert.ok(!isAllowedLicense('MIT AND (GPL-3.0-only OR (LGPL-2.1-only AND ISC))'));
        assert.ok(!isAllowedLicense('(MIT AND GPL-3.0-only) OR (ISC AND LGPL-2.1-only)'));
    });

    it('fails closed on what it does not read', () => {
        assert.ok(!isAllowedLicense('(MIT OR ISC'));
        assert.ok(!isAllowedLicense('MIT OR ISC)'));
        assert.ok(!isAllowedLicense('MIT OR'));
        assert.ok(!isAllowedLicense(''));
        assert.ok(!isAllowedLicense('MIT WITH LLVM-exception'));
        assert.ok(!isAllowedLicense('Apache-2.0+'));
    });

    it('finds the package of each bundled file, nested and scoped', () => {
        assert.deepStrictEqual(bundledPackageDirs([
            'src/core/analysis.ts',
            'node_modules/jsdom/lib/api.js',
            'node_modules/jsdom/lib/jsdom/browser/Window.js',
            'node_modules/@eslint/config-array/node_modules/minimatch/dist/esm/index.js'
        ]), ['node_modules/jsdom', 'node_modules/@eslint/config-array/node_modules/minimatch']);
    });
});
