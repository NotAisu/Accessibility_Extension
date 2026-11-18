import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as axe from 'axe-core/axe.min.js';
import { RULE_CRITERIA as JSX_RULES } from '../../src/core/jsx/engine';
import { RULE_CRITERIA as VUE_RULES } from '../../src/core/vue/engine';
import { ELEMENTS_CONTENT_CRITERIA, RULE_CRITERIA as ANGULAR_RULES } from '../../src/core/angular/engine';
import { MISSING_ATTRIBUTE_CRITERIA, WARNING_CRITERIA as SVELTE_WARNINGS } from '../../src/core/svelte/engine';
import { RULE_CRITERIA as HTML_ESLINT_RULES } from '../../src/core/html/html-eslint-check';
import { AXE_TAGS, LAYOUT_RULES } from '../../src/core/html/axe-check';
import { isTargetCriterion } from '../../src/core/wcag';

// The Marketplace page is built from package.json and README.md; these keep it from drifting from the code
const root = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
    icon?: string;
    galleryBanner?: { color?: string; theme?: string };
    bugs?: { url?: string };
    repository?: { url?: string };
    engines: { vscode: string };
};
const shipped = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf-8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');
const issues = 'https://github.com/NotAisu/Accessibility_Extension/issues';

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
    const png = fs.readFileSync(file);
    assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${file} is a PNG`);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const criteriaOf = (...tables: Record<string, string[]>[]) => tables.flatMap(table => Object.values(table).flat());

// axe-core tags its rules with the criteria they fail, as "wcag111" or "wcag1410"
const axeCriteria = axe.getRules(AXE_TAGS)
    .filter(rule => !LAYOUT_RULES.includes(rule.ruleId))
    .flatMap(rule => rule.tags.flatMap(tag => {
        const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
        return match ? [`${match[1]}.${match[2]}.${match[3]}`] : [];
    }))
    .filter(isTargetCriterion);

/** The criteria each language's upstream engine reports Findings for, keyed by the README's row label. */
const ENGINE_CRITERIA: Record<string, string[]> = {
    'HTML': [...axeCriteria, ...criteriaOf(HTML_ESLINT_RULES)],
    'JSX, TSX, Astro': criteriaOf(JSX_RULES),
    'Vue': criteriaOf(VUE_RULES),
    'Svelte': criteriaOf(SVELTE_WARNINGS, MISSING_ATTRIBUTE_CRITERIA),
    'Angular': criteriaOf(ANGULAR_RULES, ELEMENTS_CONTENT_CRITERIA)
};

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** The criteria a row of the README's Coverage section lists in its last cell. */
function readmeRow(label: string): string[] | undefined {
    const coverage = readme.slice(readme.indexOf('\n## Coverage\n'));
    const row = coverage.split('\n').find(line => line.startsWith(`| ${label} |`));
    const cells = row?.split('|');
    return cells?.[cells.length - 2].split(',').map(c => c.trim()).sort(byNumber);
}

describe('Marketplace listing', () => {
    it('lists exactly the criteria each engine reports Findings for', () => {
        for (const [label, criteria] of Object.entries(ENGINE_CRITERIA)) {
            assert.deepStrictEqual(readmeRow(label), [...new Set(criteria)].sort(byNumber), `README coverage row "${label}"`);
        }
    });

    it('names the minimum VS Code version the manifest requires', () => {
        const minimum = /^\^(\d+\.\d+)\.\d+$/.exec(manifest.engines.vscode)?.[1];
        assert.ok(minimum, manifest.engines.vscode);
        assert.ok(readme.includes(`VS Code ${minimum}`), `README names VS Code ${minimum}`);
    });

    it('links Report Issue to the issue tracker and states there is no telemetry and no account', () => {
        assert.ok(readme.includes(`[Report Issue](${issues})`), 'Report Issue link');
        assert.match(readme, /No telemetry, no account/);
    });

    it('has a 128x128 PNG icon that ships in the VSIX', () => {
        assert.ok(manifest.icon, 'icon');
        assert.deepStrictEqual(pngSize(path.join(root, manifest.icon)), { width: 128, height: 128 });
        assert.ok(shipped.includes(`!${manifest.icon}`), `${manifest.icon} ships in the VSIX`);
    });

    it('has a gallery banner', () => {
        assert.match(manifest.galleryBanner?.color ?? '', /^#[0-9a-f]{6}$/i);
        assert.ok(['dark', 'light'].includes(manifest.galleryBanner?.theme ?? ''), 'banner theme');
    });

    it('links issues as the place to report them', () => {
        assert.strictEqual(manifest.bugs?.url, issues);
    });
});
