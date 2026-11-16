/** What an issue report says about where Allyproof ran; never any code or file contents. */
export interface IssueEnvironment {
    extension: string;
    editor: string;
    os: string;
    /** The remote kind, such as `ssh-remote` or `wsl`; undefined in a local window. */
    remote: string | undefined;
    engines: { used: string[]; paused: string[] };
}

/** A new GitHub issue in `repository`, prefilled with the environment. */
export function issueUrl(repository: string, environment: IssueEnvironment): string {
    const { used, paused } = environment.engines;
    const engines = used.length === 0 ? 'none yet' : used.join(', ') + (paused.length > 0 ? ` (paused: ${paused.join(', ')})` : '');
    const body = [
        '## What happened',
        '',
        '<!-- What did you expect, and what did Allyproof do instead? -->',
        '',
        '## Steps to reproduce',
        '',
        '<!-- The smallest code that shows the problem. Allyproof does not attach any of your code. -->',
        '',
        '## Log',
        '',
        '<!-- Optional: lines from Output > Allyproof (command "Allyproof: Show Log"). -->',
        '',
        '## Environment',
        '',
        `- Allyproof: ${environment.extension}`,
        `- Editor: ${environment.editor}`,
        `- OS: ${environment.os}`,
        `- Remote: ${environment.remote ?? 'none (local)'}`,
        `- Engines used: ${engines}`
    ].join('\n');
    const url = new URL(`${repository.replace(/\/$/, '')}/issues/new`);
    url.searchParams.set('body', body);
    return url.toString();
}
