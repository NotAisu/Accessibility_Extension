# Your code is already being checked

Open an HTML, Vue, Svelte, JSX, TSX, Astro or Angular file. The Check runs while you type, offline and free, and reports each problem as a **Finding** in the Problems panel and in the **Findings** view behind the Allyproof icon in the Activity Bar. Your file is parsed, never executed.

For example, this page has no language:

```html
<html>
  <body>…</body>
</html>
```

The Check reports *3.1.1 Language of Page* on `<html>`. Put the cursor on it and press `Ctrl+.` (`Cmd+.` on macOS) for the quick fix **Add lang="en"**. Hover a Finding for an explanation and a link to the WCAG criterion.

Some criteria, such as color contrast or target size, cannot be decided from source. The Check lists them per file as **Needs Review** instead of guessing.
