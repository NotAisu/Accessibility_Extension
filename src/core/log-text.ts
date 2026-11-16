const MAX_LOGGED = 200;

/**
 * An error message as the log may keep it. Engine, parser and model errors can quote the checked code or the
 * prompt, often in a code frame on the lines after the first, so only the first line goes, capped.
 */
export function logText(message: string): string {
    const [first] = message.split(/\r?\n/, 1);
    return first.length > MAX_LOGGED ? `${first.slice(0, MAX_LOGGED)}…` : first;
}
