const esbuild = require('esbuild');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// The lowest supported runtime: engines.vscode ^1.123.0 ships Node 24.15 (covers Cursor 3.x).
// The CI gate runs on the same version; raising it needs a recorded reason in the spec (#5).
const TARGET = 'node24.15';

// Packages of the language engines; each must stay out of the activation shell
const ENGINE_PACKAGES = ['jsdom', 'axe-core', 'eslint', '@html-eslint', 'eslint-plugin-jsx-a11y-x', 'eslint-plugin-vuejs-accessibility', 'vue-eslint-parser', '@typescript-eslint', 'typescript', 'svelte', '@angular-eslint', 'eslint-plugin-astro', 'astro-eslint-parser', '@astrojs', '@napi-rs', '@emnapi'];

// The Astro compiler's WASM/WASI build is published for cpu wasm32 only, so npm never installs it and
// would otherwise load a native binding. It is taken from the tarball the lockfile pins, through npm so the
// registry configuration applies, and checked against the lockfile's integrity.
function astroWasiBinding() {
    const name = '@astrojs/compiler-binding-wasm32-wasi';
    const locked = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages[`node_modules/${name}`];
    // Laid out as an installed package inside node_modules, so its own requires resolve to the installed runtime
    // packages and the third-party notices find its manifest
    const cache = path.resolve('node_modules', '.cache', 'allyproof', `astro-wasi-${locked.version}`);
    const dir = path.join(cache, 'node_modules', name);
    const entry = path.join(dir, 'astro.wasi.cjs');
    if (fs.existsSync(entry)) return entry;
    fs.rmSync(cache, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const [packed] = JSON.parse(execFileSync('npm', ['pack', `${name}@${locked.version}`, '--json', '--pack-destination', cache], { encoding: 'utf8', shell: process.platform === 'win32' }));
    if (packed.integrity !== locked.integrity) {
        throw new Error(`${name}@${locked.version} does not match the integrity in package-lock.json`);
    }
    execFileSync('tar', ['-xzf', path.join(cache, packed.filename), '-C', dir, '--strip-components=1']);
    return entry;
}

// Engine bundling pitfalls that only show once bundled
const fixEnginePitfalls = {
    name: 'fix-engine-pitfalls',
    setup(build) {
        // jsdom resolves its sync XHR worker file at load time, which fails inside a bundle.
        // Sync XHR is only reachable from page scripts, and the Check never runs those.
        build.onLoad({ filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]xhr[\\/]XMLHttpRequest-impl\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            // jsdom 30 dropped the `require.resolve ?` guard around the same call
            const patched = source.replace(
                /const syncWorkerFile = (?:require\.resolve \? )?require\.resolve\("\.\/xhr-sync-worker\.js"\)(?: : null)?;/,
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
        // The Astro compiler's WASI glue reads its .wasm next to __dirname, which the bundle does not have; the
        // module is inlined instead. Parsing a string needs no file system, environment or threads, so the
        // WASI instance gets none of them.
        build.onLoad({ filter: /compiler-binding-wasm32-wasi[\\/]astro\.wasi\.cjs$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source
                .replace(/let __wasmFilePath = [\s\S]*?\n}\n/, '')
                .replace('__nodeFs.readFileSync(__wasmFilePath)', 'require("./astro.wasm32-wasi.wasm")')
                .replace(/  env: process\.env,\n  preopens: {\n    \[__rootDir\]: __rootDir,\n  }\n/, '  env: {},\n  preopens: {}\n')
                .replace(/onCreateWorker\(\) {[\s\S]*?\n  },\n  overwriteImports/, 'onCreateWorker() {\n    throw new Error("The Check parses Astro without threads")\n  },\n  overwriteImports');
            if (patched.includes('__wasmFilePath') || patched.includes('__rootDir]') || patched.includes('new Worker(')) {
                throw new Error('Astro compiler WASI glue not as expected; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
        // eslint-plugin-astro looks up eslint-plugin-jsx-a11y(-x), the TypeScript parser and espree in the working
        // directory, or espree beside an ESLint in the require cache, and style preprocessors beside the checked
        // file. Each would run workspace code (ADR 0002), so they come from a static import map of bundled copies.
        build.onLoad({ filter: /eslint-plugin-astro[\\/]lib[\\/]index\.mjs$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source
                .replace(
                    'import * as espree from "espree";',
                    'import * as espree from "espree";\nimport * as bundledJsxA11y from "eslint-plugin-jsx-a11y-x";\nimport * as bundledTsParser from "@typescript-eslint/parser";\n'
                    + 'const BUNDLED = { "eslint-plugin-jsx-a11y-x": bundledJsxA11y.default ?? bundledJsxA11y, "@typescript-eslint/parser": bundledTsParser, espree };'
                )
                .replace(/function requireUserLocal\(id\) {[\s\S]*?\n}\n/, 'function requireUserLocal(id) {\n\treturn BUNDLED[id] ?? null;\n}\n')
                .replace(/function loadModule\(context, name\) {[\s\S]*?\n}\n/, 'function loadModule(context, name) {\n\treturn null;\n}\n')
                .replace(/function resolveModule\(context, name\) {[\s\S]*?\n}\n/, 'function resolveModule(context, name) {\n\treturn null;\n}\n')
                .replace(/function getEspree\(\) {[\s\S]*?\n}\n/, 'function getEspree() {\n\treturn espree;\n}\n');
            if (/process\.cwd\(\)|context\.cwd|createRequire\(|Module\._cache/.test(patched.replace('cwd: context.cwd ?? process.cwd(),', ''))) {
                throw new Error('eslint-plugin-astro module lookup not as expected; update the esbuild stub');
            }
            return { contents: patched, loader: 'js' };
        });
        // astro-eslint-parser prefers eslint-scope and espree from the working directory or from an ESLint in the
        // require cache, which would run workspace code (ADR 0002), so the bundled copies are always used. Its
        // typescript lookups only run with parserOptions.project, which the Check never sets.
        build.onLoad({ filter: /astro-eslint-parser[\\/]lib[\\/]index\.mjs$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8');
            const patched = source
                .replace(/function getEslintScopeFromUser\(\) {[\s\S]*?\n}\n/, 'function getEslintScopeFromUser() {\n\treturn null;\n}\n')
                .replace(/function getEslintScopeFromEslint\(\) {[\s\S]*?\n}\n/, 'function getEslintScopeFromEslint() {\n\treturn null;\n}\n')
                .replace('import { parse } from "@astrojs/compiler-rs";', 'import { parse } from "@astrojs/compiler-rs";\nimport * as bundledEspree from "espree";')
                .replace(/function getEspree\(\) {[\s\S]*?\n}\n/, 'function getEspree() {\n\treturn bundledEspree;\n}\n');
            if (!patched.includes('bundledEspree;') || patched.includes('createRequire(linterPath)') || patched.includes('"eslint-scope")') || patched.includes('resolve("eslint/package.json")')) {
                throw new Error('astro-eslint-parser module lookup not as expected; update the esbuild stub');
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
        alias: {
            'vscode-css-languageservice': 'vscode-css-languageservice/lib/esm/cssLanguageService.js',
            '@astrojs/compiler-binding': astroWasiBinding()
        },
        // The Astro compiler's WASM module, inlined into the Astro chunk
        loader: { '.wasm': 'binary' },
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
