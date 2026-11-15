/** Character offset of each line start, so ESLint's 1-based line/column positions map to text offsets. */
export function lineOffsets(text: string): number[] {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
}
