import type { NeedsReview } from './analysis';

/** What a document renders that only layout can judge; each engine detects it in its own syntax. */
export interface RenderedContent {
    text: boolean;
    controls: boolean;
}

// The same entries for every language, so the Findings tree reads alike across engines
export function layoutNeedsReview(content: RenderedContent): NeedsReview[] {
    const entries: NeedsReview[] = [];
    if (content.text) entries.push({ criterion: '1.4.3', reason: 'Text contrast depends on rendered colors.' });
    if (content.controls) entries.push({ criterion: '2.5.8', reason: 'Target size depends on rendered layout.' });
    return entries;
}

/** Elements a user can point at, as in the HTML engine's selector; `role` and `type` are their literal values. */
export function isControl(tag: string, attributes: Map<string, string | true>): boolean {
    const type = attributes.get('type');
    const role = attributes.get('role');
    return (tag === 'a' && attributes.has('href'))
        || ['button', 'select', 'textarea', 'summary'].includes(tag)
        || (tag === 'input' && type !== 'hidden')
        || attributes.has('tabindex')
        || role === 'button' || role === 'link';
}
