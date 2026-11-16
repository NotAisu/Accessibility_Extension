// Runs the extension-host smoke tests against the packaged VSIX, unpacked as VS Code installs it, once in a trusted
// and once in an untrusted workspace. @vscode/test-electron's runTests always disables Workspace Trust, so VS Code is
// launched here directly. On Linux CI it needs a display: run it under xvfb-run.
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as esbuild from 'esbuild';

// The lowest version engines.vscode allows
const VSCODE_VERSION = '1.123.0';
const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'out', 'extension-host');

type Trust = 'trusted' | 'untrusted';

async function main(): Promise<void> {
    // Short: VS Code's IPC socket in the user data directory must fit 103 characters
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-'));
    try {
        const extension = packageExtension(temp);
        // Bundled beside the repository's node_modules, which provides mocha
        await esbuild.build({
            entryPoints: { index: path.join(__dirname, 'index.ts'), suite: path.join(__dirname, 'suite.ts') },
            outdir: out,
            outExtension: { '.js': '.cjs' },
            bundle: true,
            platform: 'node',
            format: 'cjs',
            external: ['vscode', 'mocha'],
            logLevel: 'warning'
        });
        const executable = await downloadAndUnzipVSCode(VSCODE_VERSION);
        let failed = false;
        for (const trust of ['trusted', 'untrusted'] as const) {
            failed = (await launch(executable, extension, path.join(temp, trust[0]), trust)) !== 0 || failed;
        }
        if (failed) process.exitCode = 1;
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

function packageExtension(temp: string): string {
    const vsix = path.join(temp, 'allyproof.vsix');
    execFileSync('npx', ['vsce', 'package', '--out', vsix], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    execFileSync('unzip', ['-q', vsix, '-d', path.join(temp, 'vsix')]);
    return path.join(temp, 'vsix', 'extension');
}

function launch(executable: string, extension: string, dir: string, trust: Trust): Promise<number | null> {
    // A fresh copy per run: the quick fix test edits and saves its file
    const workspace = path.join(dir, 'workspace');
    fs.cpSync(path.join(__dirname, 'workspace'), workspace, { recursive: true });
    const userData = path.join(dir, 'u');
    fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
    // Restricted Mode without the startup dialog, which would block the run
    fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'security.workspace.trust.startupPrompt': 'never' }));

    const args = [
        workspace,
        `--extensionDevelopmentPath=${extension}`,
        `--extensionTestsPath=${path.join(out, 'index.cjs')}`,
        `--user-data-dir=${userData}`,
        `--extensions-dir=${path.join(dir, 'extensions')}`,
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-extensions',
        ...(trust === 'trusted' ? ['--disable-workspace-trust'] : [])
    ];
    console.log(`\nExtension host, ${trust} workspace`);
    const child = spawn(executable, args, { env: { ...process.env, ALLYPROOF_TRUST: trust }, stdio: 'inherit' });
    return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', code => resolve(code));
    });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
