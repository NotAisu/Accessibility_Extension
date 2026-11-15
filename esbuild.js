const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The lowest supported runtime: engines.vscode ^1.123.0 ships Node 24.15 (covers Cursor 3.x).
// The CI gate runs on the same version; raising it needs a recorded reason in the spec (#5).
const TARGET = 'node24.15';

// Packages of the language engines; each must stay out of the activation shell
const ENGINE_PACKAGES = ['jsdom', 'axe-core', 'eslint', '@html-eslint', 'eslint-plugin-jsx-a11y-x', 'eslint-plugin-vuejs-accessibility', 'vue-eslint-parser', '@typescript-eslint', 'typescript', 'svelte', '@angular-eslint'];

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
        // eslint-plugin-jsx-a11y-x reads its name and version from package.json through a runtime
        // require next to the source file, which the bundle does not ship. A static import is inlined.
        build.onLoad({ filter: /eslint-plugin-jsx-a11y-x[\\/]lib[\\/]index\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source.replace(
                "const { name, version } = require('../package.json');",
                "import pluginPackage from '../package.json';\nconst { name, version } = pluginPackage;"
            );
            if (patched === source) {
                throw new Error('eslint-plugin-jsx-a11y-x package.json require not found; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
        // eslint-plugin-vuejs-accessibility's eslintrc config resolves vue-eslint-parser's path at load time,
        // which fails inside a bundle. The Check passes the parser itself and never uses that config.
        build.onLoad({ filter: /eslint-plugin-vuejs-accessibility[\\/]dist[\\/]configs[\\/]recommended\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source.replace('parser: require.resolve("vue-eslint-parser"),', 'parser: "vue-eslint-parser",');
            if (patched === source) {
                throw new Error('eslint-plugin-vuejs-accessibility require.resolve not found; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
        // vue-eslint-parser prefers espree and eslint-scope from the working directory's node_modules, which
        // would run workspace code (ADR 0002), so the bundled copies are always used. Its require("eslint")
        // for SourceCode would bundle ESLint's Node API; only custom blocks reach it, and no rule the Check
        // runs visits them.
        build.onLoad({ filter: /vue-eslint-parser[\\/]dist[\\/]index\.cjs$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source
                .replaceAll('const cwd = process.cwd();', 'throw new Error("The Check uses its bundled parser only");')
                .replace('new (require("eslint")).SourceCode(', 'new (() => { throw new Error("The Check does not lint custom blocks"); })(');
            if (source.split('process.cwd()').length !== 4 || patched.includes('process.cwd()') || patched.includes('require("eslint")')) {
                throw new Error('vue-eslint-parser working-directory or eslint require not found as expected; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
        // @typescript-eslint/utils exports TSESLint, wrappers around ESLint's Node API (ESLint, Linter,
        // RuleTester) that would bundle its config loader. @angular-eslint's rules never use them.
        build.onLoad({ filter: /@typescript-eslint[\\/]utils[\\/]dist[\\/]index\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source.replace('exports.TSESLint = __importStar(require("./ts-eslint"));', 'exports.TSESLint = {};');
            if (patched === source) {
                throw new Error('@typescript-eslint/utils TSESLint export not found; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
        // TypeScript's node sys reads __filename and __dirname at load time, which ESM output does not
        // define. It needs them only to find its lib files and probe case sensitivity, never to parse.
        build.onLoad({ filter: /typescript[\\/]lib[\\/]typescript\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            return { contents: `var __filename = "typescript.js", __dirname = ".";\n${source}`, loader: 'js' };
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
        .filter(input => ENGINE_PACKAGES.some(name => input.includes(`node_modules/${name}/`)));
    if (engines.length > 0) {
        throw new Error(`The activation shell statically loads engine code, import it lazily: ${engines[0]}`);
    }
}

async function main() {
    // Chunk names carry a hash, so chunks of earlier builds would otherwise ship in the VSIX
    fs.rmSync('dist', { recursive: true, force: true });
    const ctx = await esbuild.context({
        // worker.mjs runs the analysis core in the analysis worker; the bundle gate measures through it
        entryPoints: { extension: 'src/extension.ts', worker: 'src/core/worker.ts' },
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
        // The bundled inputs, for scripts/third-party-notices.ts; not shipped
        fs.writeFileSync('dist/meta.json', JSON.stringify(result.metafile));
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
