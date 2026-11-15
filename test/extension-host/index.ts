import * as path from 'path';
import Mocha from 'mocha';

// Entry point VS Code loads through --extensionTestsPath
export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', timeout: 60000, color: true });
    mocha.addFile(path.join(__dirname, 'suite.cjs'));
    const failures = await new Promise<number>(resolve => mocha.run(resolve));
    if (failures > 0) throw new Error(`${failures} extension-host tests failed`);
}
