import type { Finding } from './analysis';

type Fix = Pick<Finding, 'fix' | 'quickFixOnly'>;
type Fixer = (text: string, finding: Finding) => Fix | undefined;

// Deterministic fixes for problems with exactly one right edit, recognised by the Finding's primary
// criterion and the source at its range, so every engine's rule for the same problem gets them
const FIXERS: Fixer[] = [addLang, removeAriaHiddenFromBody];

/** The Findings with a `fix` wherever the problem has one unambiguous fix. */
export function withFixes(text: string, findings: Finding[]): Finding[] {
    return findings.map(finding => {
        for (const fixer of FIXERS) {
            const fix = fixer(text, finding);
            if (fix) return { ...finding, ...fix };
        }
        return finding;
    });
}

// `<html>` without any lang attribute; an empty or wrong lang needs the author's language. English is a
// guess, so the user applies it as a quick fix only
function addLang(text: string, finding: Finding): Fix | undefined {
    const attributes = startTag(text, finding, 'html', '3.1.1');
    if (!attributes || attributes.some(({ name }) => name === 'lang')) return undefined;
    const at = finding.range.start + '<html'.length;
    return { fix: [{ range: { start: at, end: at }, newText: ' lang="en"' }], quickFixOnly: true };
}

function removeAriaHiddenFromBody(text: string, finding: Finding): Fix | undefined {
    const hidden = startTag(text, finding, 'body', '1.3.1')?.filter(({ name }) => name === 'aria-hidden');
    if (!hidden?.length) return undefined;
    return { fix: hidden.map(({ range }) => ({ range, newText: '' })) };
}

/** An attribute of a start tag: its lowercase name, and its source range with the whitespace before it. */
interface Attribute {
    name: string;
    range: { start: number; end: number };
}

// The attributes of the start tag of the element at the Finding's range, when the Finding is about this criterion.
// Undefined when the tag cannot be read to its end, so a fix is never placed by guessing
function startTag(text: string, finding: Finding, element: string, criterion: string): Attribute[] | undefined {
    if (finding.criteria[0] !== criterion) return undefined;
    let at = finding.range.start;
    if (!new RegExp(`^<${element}(?=[\\s/>])`, 'iy').test(text.slice(at, at + element.length + 2))) return undefined;
    at += 1 + element.length;
    const attributes: Attribute[] = [];
    for (;;) {
        const start = at;
        at = skip(text, at, /\s*/y);
        if (text[at] === '>' || text.startsWith('/>', at)) return attributes;
        // A JSX or Svelte spread or shorthand ({...props}, {value}) has no name
        const nameEnd = text[at] === '{' ? balanced(text, at) : skip(text, at, /[^\s"'<>/={}]+/y);
        if (nameEnd === undefined || nameEnd === at) return undefined;
        const name = text.slice(at, nameEnd).toLowerCase();
        at = nameEnd;
        const equals = skip(text, at, /\s*=\s*/y);
        if (equals !== at) {
            at = equals;
            const quote = text[at];
            const valueEnd = quote === '"' || quote === "'" ? text.indexOf(quote, at + 1) + 1
                : quote === '{' ? balanced(text, at) : skip(text, at, /[^\s>]+/y);
            if (!valueEnd || valueEnd === at) return undefined;
            at = valueEnd;
        }
        attributes.push({ name, range: { start, end: at } });
    }
}

function skip(text: string, at: number, pattern: RegExp): number {
    pattern.lastIndex = at;
    return pattern.exec(text) ? pattern.lastIndex : at;
}

// The end of a {…} expression starting at `at`, skipping quoted strings inside it; undefined when it never closes
function balanced(text: string, at: number): number | undefined {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
        const char = text[i];
        if (char === '"' || char === "'" || char === '`') {
            const close = text.indexOf(char, i + 1);
            if (close === -1) return undefined;
            i = close;
        } else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return i + 1;
    }
    return undefined;
}
