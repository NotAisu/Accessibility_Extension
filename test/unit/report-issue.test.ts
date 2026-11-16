import * as assert from 'assert';
import { issueUrl } from '../../src/report-issue';

const environment = {
    extension: '0.1.0',
    editor: 'Visual Studio Code 1.124.0',
    os: 'darwin 25.6.0 (arm64)',
    remote: 'ssh-remote',
    engines: { used: ['html', 'vue'], paused: ['vue'] }
};

describe('Report Issue', () => {
    it('opens a new issue in the repository, prefilled with the environment', () => {
        const url = new URL(issueUrl('https://github.com/NotAisu/Accessibility_Extension', environment));
        const body = url.searchParams.get('body')!;

        assert.strictEqual(`${url.origin}${url.pathname}`, 'https://github.com/NotAisu/Accessibility_Extension/issues/new');
        for (const line of [
            '- Allyproof: 0.1.0',
            '- Editor: Visual Studio Code 1.124.0',
            '- OS: darwin 25.6.0 (arm64)',
            '- Remote: ssh-remote',
            '- Engines used: html, vue (paused: vue)'
        ]) assert.ok(body.includes(line), `${line} missing from:\n${body}`);
    });

    it('names a local window and a session without Checks', () => {
        const body = new URL(issueUrl('https://github.com/o/r', { ...environment, remote: undefined, engines: { used: [], paused: [] } }))
            .searchParams.get('body')!;

        assert.ok(body.includes('- Remote: none (local)'));
        assert.ok(body.includes('- Engines used: none yet'));
    });

    it('asks for a minimal example instead of attaching code', () => {
        const body = new URL(issueUrl('https://github.com/o/r', environment)).searchParams.get('body')!;

        assert.match(body, /smallest code that shows the problem/);
    });
});
