// Writes dist/THIRD-PARTY-NOTICES.txt from the packages esbuild put into the bundle (dist/meta.json),
// and fails when a bundled package has a license outside the allowlist.
import * as fs from 'fs';
import * as path from 'path';

// Licenses a bundled package may carry. MPL-2.0 (axe-core) is file-level copyleft: fine while unmodified.
export const ALLOWED_LICENSES = [
    '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0'
];

// The bundle quotes WCAG 2.2 success criterion names from this file
const W3C_SOURCE = 'src/core/wcag.ts';

interface PackageNotice {
    name: string;
    version: string;
    license: string;
    texts: string[];
}

// An SPDX expression is allowed when one OR alternative has only allowed AND terms, at any bracket depth.
// AND binds tighter than OR. Anything else (WITH, `+`, malformed brackets) fails closed.
export function isAllowedLicense(expression: string): boolean {
    const tokens = expression.match(/[()]|[^\s()]+/g) ?? [];
    let pos = 0;
    const fail = (): never => { throw new Error(`Unsupported SPDX expression: ${expression}`); };
    const term = (): boolean => {
        const token = tokens[pos++];
        if (token === '(') {
            const allowed = or();
            if (tokens[pos++] !== ')') fail();
            return allowed;
        }
        if (token === undefined || token === ')' || token === 'AND' || token === 'OR') fail();
        return ALLOWED_LICENSES.includes(token);
    };
    const and = (): boolean => {
        let allowed = term();
        while (tokens[pos] === 'AND') { pos++; allowed = term() && allowed; }
        return allowed;
    };
    const or = (): boolean => {
        let allowed = and();
        while (tokens[pos] === 'OR') { pos++; allowed = and() || allowed; }
        return allowed;
    };
    try {
        const allowed = or();
        return pos === tokens.length && allowed;
    } catch {
        return false;
    }
}

// Package directories of bundled input files, the innermost node_modules entry of each path
export function bundledPackageDirs(inputs: string[]): string[] {
    const dirs = inputs.map(input => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1]);
    return [...new Set(dirs.filter((dir): dir is string => dir !== undefined))];
}

function readNotice(dir: string): PackageNotice {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as
        { name: string; version: string; license?: string | { type: string } };
    const license = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? 'UNKNOWN';
    const files = fs.readdirSync(dir).filter(file => /^(licen[cs]e|copying|notice)/i.test(file)).sort();
    const texts = files.map(file => fs.readFileSync(path.join(dir, file), 'utf-8').trim());
    return { name: manifest.name, version: manifest.version, license, texts };
}

function w3cNotice(): string {
    const act = fs.readFileSync(path.join('test', 'ground-truth', 'act', 'LICENSE-W3C.md'), 'utf-8');
    const license = act.slice(act.indexOf('## W3C Software And Document Notice And License'));
    return [
        'Web Content Accessibility Guidelines (WCAG) 2.2',
        'Allyproof includes the names of WCAG 2.2 success criteria copied from',
        'Web Content Accessibility Guidelines (WCAG) 2.2, https://www.w3.org/TR/WCAG22/.',
        'Copyright © 2023 W3C® (MIT, ERCIM, Keio, Beihang).',
        '',
        license.trim()
    ].join('\n');
}

function renderNotices(notices: PackageNotice[], includeW3c: boolean): string {
    const separator = '\n\n' + '-'.repeat(80) + '\n\n';
    const sections = notices.map(notice => [
        `${notice.name}@${notice.version}`,
        `License: ${notice.license}`,
        '',
        notice.texts.length > 0 ? notice.texts.join('\n\n') : '(the package ships no license file)'
    ].join('\n'));
    if (includeW3c) sections.push(w3cNotice());
    const header = 'THIRD-PARTY NOTICES\n\nAllyproof bundles the following third-party material.';
    return [header, ...sections].join(separator) + '\n';
}

function main(): void {
    const inputs = Object.keys((JSON.parse(fs.readFileSync('dist/meta.json', 'utf-8')) as { inputs: object }).inputs);
    const byId = new Map(bundledPackageDirs(inputs).map(readNotice).map(n => [`${n.name}@${n.version}`, n]));
    const notices = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
    const disallowed = notices.filter(notice => !isAllowedLicense(notice.license));
    if (disallowed.length > 0) {
        console.error('Bundled packages with a license outside the allowlist in scripts/third-party-notices.ts:');
        disallowed.forEach(notice => console.error(`  ${notice.name}@${notice.version}: ${notice.license}`));
        process.exit(1);
    }
    fs.writeFileSync(path.join('dist', 'THIRD-PARTY-NOTICES.txt'), renderNotices(notices, inputs.includes(W3C_SOURCE)));
    console.log(`THIRD-PARTY-NOTICES.txt: ${notices.length} bundled packages`);
}

if (require.main === module) {
    main();
}
