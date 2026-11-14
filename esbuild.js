const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// jsdom resolves its sync XHR worker file at load time, which fails inside a bundle.
// Sync XHR is only reachable from page scripts, and the Check never runs those.
const stubJsdomSyncXhr = {
    name: 'stub-jsdom-sync-xhr',
    setup(build) {
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

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        outfile: 'dist/extension.js',
        // canvas is an optional jsdom peer; bufferutil/utf-8-validate are optional ws add-ons
        external: ['vscode', 'canvas', 'bufferutil', 'utf-8-validate'],
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'info',
        plugins: [stubJsdomSyncXhr]
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
