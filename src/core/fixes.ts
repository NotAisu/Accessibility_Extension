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
    const tag = startTag(text, finding, 'html', '3.1.1');
    if (!tag || /\slang\b/i.test(tag)) return undefined;
    const at = finding.range.start + '<html'.length;
    return { fix: [{ range: { start: at, end: at }, newText: ' lang="en"' }], quickFixOnly: true };
}

function removeAriaHiddenFromBody(text: string, finding: Finding): Fix | undefined {
    const tag = startTag(text, finding, 'body', '1.3.1');
    const attribute = tag && /\s+aria-hidden(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i.exec(tag);
    if (!attribute) return undefined;
    const start = finding.range.start + attribute.index;
    return { fix: [{ range: { start, end: start + attribute[0].length }, newText: '' }] };
}

// The start tag of the element at the Finding's range, when the Finding is about this criterion
function startTag(text: string, finding: Finding, element: string, criterion: string): string | undefined {
    if (finding.criteria[0] !== criterion) return undefined;
    return new RegExp(`^<${element}(?=[\\s/>])[^>]*>`, 'i').exec(text.slice(finding.range.start))?.[0];
}
