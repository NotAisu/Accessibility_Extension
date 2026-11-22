function inlineValue(style: string | true | undefined, property: 'display' | 'visibility'): string | undefined {
    if (typeof style !== 'string') return undefined;
    let value: string | undefined;
    let important = false;
    for (const declaration of style.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon === -1 || declaration.slice(0, colon).trim().toLowerCase() !== property) continue;
        const next = declaration.slice(colon + 1).trim().toLowerCase();
        const nextImportant = /!\s*important$/.test(next);
        if (!next || important && !nextImportant) continue;
        value = next.replace(/!\s*important$/, '').trim();
        important = nextImportant;
    }
    return value;
}

export function inlineDisplayNone(style: string | true | undefined): boolean {
    return inlineValue(style, 'display') === 'none';
}

/** Undefined means the element can still inherit visibility from its parent. */
export function inlineVisibilityHidden(style: string | true | undefined): boolean | undefined {
    const value = inlineValue(style, 'visibility');
    if (value === 'hidden' || value === 'collapse') return true;
    if (value === 'visible' || value === 'initial') return false;
    return undefined;
}
