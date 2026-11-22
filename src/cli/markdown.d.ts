// esbuild inlines Markdown files as text (the `.md` loader in esbuild.js)
declare module '*.md' {
    const text: string;
    export default text;
}
