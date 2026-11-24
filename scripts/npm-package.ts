// Writes the npm package of the command line (#79) to out/npm from the bundle: the CLI, the worker and the engine
// chunks it loads, the JSON Schema of its output and the notices. Every dependency is bundled, so it has none.
//   npm run bundle && npx ts-node scripts/npm-package.ts && npm publish out/npm --provenance
import * as fs from 'fs';
import * as path from 'path';

export interface RootManifest {
    name: string;
    version: string;
    license: string;
    repository?: unknown;
    homepage?: string;
    engines?: { node?: string };
}

export function buildNpmManifest(manifest: RootManifest) {
    return {
        name: manifest.name,
        version: manifest.version,
        description: 'Check HTML, React, Vue, Svelte, Angular and Astro code against WCAG 2.2 AA from the command line',
        license: manifest.license,
        homepage: manifest.homepage ?? 'https://github.com/NotAisu/Accessibility_Extension#readme',
        repository: manifest.repository,
        keywords: [
            'accessibility', 'a11y', 'wcag', 'wcag-2-2',
            'mcp', 'mcp-server', 'agent-skills', 'linter',
            'html', 'react', 'vue', 'svelte', 'angular', 'astro'
        ],
        type: 'module',
        bin: { allyproof: 'cli.mjs' },
        exports: { './schema/check-result.v1.json': './schema/check-result.v1.json' },
        engines: { node: '>=24.15.0' },
        files: ['cli.mjs', 'worker.mjs', 'chunks', 'schema', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'README.md']
    };
}

function main(): void {
    const root = path.join(__dirname, '..');
    const out = path.join(root, 'out', 'npm');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as RootManifest;

    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'schema'), { recursive: true });
    fs.cpSync(path.join(root, 'dist', 'chunks'), path.join(out, 'chunks'), { recursive: true });
    fs.copyFileSync(path.join(root, 'dist', 'worker.mjs'), path.join(out, 'worker.mjs'));
    fs.writeFileSync(path.join(out, 'cli.mjs'), `#!/usr/bin/env node\n${fs.readFileSync(path.join(root, 'dist', 'cli.mjs'), 'utf-8')}`, { mode: 0o755 });
    fs.copyFileSync(path.join(root, 'schema', 'check-result.v1.json'), path.join(out, 'schema', 'check-result.v1.json'));
    for (const file of ['LICENSE', 'dist/THIRD-PARTY-NOTICES.txt']) fs.copyFileSync(path.join(root, file), path.join(out, path.basename(file)));
    fs.writeFileSync(path.join(out, 'README.md'), [
        '# allyproof',
        '',
        'The command line of [Allyproof](https://github.com/NotAisu/Accessibility_Extension): the same WCAG 2.2 AA Check as the VS Code extension, for commit hooks, CI and coding agents. No network, no AI; your code is parsed, never run.',
        '',
        '```sh',
        'npx allyproof check            # the repository',
        'npx allyproof check --staged   # what is about to be committed',
        'npx allyproof explain image-alt',
        'npx allyproof mcp              # an MCP server over stdio for coding agents: the Check, rule docs and the Skill',
        '```',
        '',
        'Run `npx allyproof --help` for every option and exit code. The JSON output follows `schema/check-result.v1.json`.',
        ''
    ].join('\n'));
    fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(buildNpmManifest(manifest), null, 2) + '\n');
    console.log(`Wrote ${path.relative(root, out)} (${manifest.name}@${manifest.version})`);
}

if (require.main === module) {
    main();
}
