import { ENGINES } from './core/analysis';
import type { EngineUsage } from './analysis-worker';

/** What an issue report says about where Allyproof ran; never any code or file contents. */
export interface IssueEnvironment {
    extension: string;
    editor: string;
    os: string;
    /** The remote kind, such as `ssh-remote` or `wsl`; undefined in a local window. */
    remote: string | undefined;
    engines: EngineUsage;
}

/** A new GitHub issue in `repository`, prefilled with the environment. */
export function issueUrl(repository: string, environment: IssueEnvironment): string {
    const { used, paused } = environment.engines;
    // Every engine, so a report also says which never loaded; a paused engine was also used
    const engines = Object.entries(ENGINES).map(([engine, languages]) => {
        const state = languages.some(l => paused.includes(l)) ? 'paused' : languages.some(l => used.includes(l)) ? 'used' : 'not loaded';
        return `${engine} (${state})`;
    }).join(', ');
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
        `- Engines: ${engines}`
    ].join('\n');
    const url = new URL(`${repository.replace(/\/$/, '')}/issues/new`);
    url.searchParams.set('body', body);
    return url.toString();
}
