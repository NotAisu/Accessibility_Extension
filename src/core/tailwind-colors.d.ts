// Tailwind's default palette; its types are ESM-only, which this CommonJS build cannot resolve
declare module 'tailwindcss/colors' {
    const colors: Record<string, string | Record<string, string>>;
    export = colors;
}
