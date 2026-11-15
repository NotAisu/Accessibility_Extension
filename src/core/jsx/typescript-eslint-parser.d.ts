// The parser's types sit behind package exports, which the project's node10 module resolution cannot read
declare module '@typescript-eslint/parser' {
    import type { Linter } from 'eslint';
    export const parseForESLint: NonNullable<Extract<Linter.Parser, { parseForESLint: unknown }>['parseForESLint']>;
}
