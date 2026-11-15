const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The lowest supported runtime: engines.vscode ^1.123.0 ships Node 24.15 (covers Cursor 3.x).
// The CI gate runs on the same version; raising it needs a recorded reason in the spec (#5).
const TARGET = 'node24.15';

// Engine bundling pitfalls that only show once bundled
const fixEnginePitfalls = {
    name: 'fix-engine-pitfalls',
    setup(build) {
        // jsdom resolves its sync XHR worker file at load time, which fails inside a bundle.
        // Sync XHR is only reachable from page scripts, and the Check never runs those.
        build.onLoad({ filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]xhr[\\/]XMLHttpRequest-impl\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source.replace(
                'const syncWorkerFile = require.resolve ? require.resolve("./xhr-sync-worker.js") : null;',
                'const syncWorkerFile = null;'
            );
            if (patched === source) {
                throw new Error('jsdom sync XHR worker line not found; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
    }
};

// Activation loads only the shell: no engine package may be reachable through static imports
function assertShellHasNoEngine(metafile) {
    const outputs = metafile.outputs;
    const shell = Object.keys(outputs).find(file => outputs[file].entryPoint === 'src/extension.ts');
    const seen = new Set();
    const visit = file => {
        if (seen.has(file)) return;
        seen.add(file);
        outputs[file].imports.filter(i => i.kind === 'import-statement' && outputs[i.path]).forEach(i => visit(i.path));
    };
    visit(shell);
    const engines = [...seen].flatMap(file => Object.keys(outputs[file].inputs))
        .filter(input => /node_modules[\\/](jsdom|axe-core|eslint|@html-eslint)[\\/]/.test(input));
    if (engines.length > 0) {
        throw new Error(`The activation shell statically loads engine code, import it lazily: ${engines[0]}`);
    }
}

async function main() {
    // Chunk names carry a hash, so chunks of earlier builds would otherwise ship in the VSIX
    fs.rmSync('dist', { recursive: true, force: true });
    const ctx = await esbuild.context({
        // analysis.mjs is the core on its own, for the bundle gate (and the analysis worker, #29)
        entryPoints: { extension: 'src/extension.ts', analysis: 'src/core/analysis.ts' },
        bundle: true,
        format: 'esm',
        splitting: true,
        platform: 'node',
        target: TARGET,
        outdir: 'dist',
        outExtension: { '.js': '.mjs' },
        chunkNames: 'chunks/[name]-[hash]',
        // Bundled CommonJS packages call require() for Node builtins, which ESM output has no binding for
        banner: { js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);" },
        // canvas is an optional jsdom peer; bufferutil/utf-8-validate are optional ws add-ons. All are
        // native and loaded in try/catch, so leaving them out keeps the VSIX universal.
        external: ['vscode', 'canvas', 'bufferutil', 'utf-8-validate'],
        // The UMD build of this @html-eslint dependency resolves its modules dynamically, which a bundle cannot follow
        alias: { 'vscode-css-languageservice': 'vscode-css-languageservice/lib/esm/cssLanguageService.js' },
        metafile: true,
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'info',
        plugins: [fixEnginePitfalls]
    });
    if (watch) {
        await ctx.watch();
    } else {
        const result = await ctx.rebuild();
        await ctx.dispose();
        assertShellHasNoEngine(result.metafile);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
