/** Character offset of each line start, so ESLint's 1-based line/column positions map to text offsets. */
export function lineOffsets(text: string): number[] {
    // The line breaks ESLint counts, so its line numbers index this array
    return [0, ...[...text.matchAll(/\r\n|[\r\n\u2028\u2029]/g)].map(m => m.index + m[0].length)];
}
