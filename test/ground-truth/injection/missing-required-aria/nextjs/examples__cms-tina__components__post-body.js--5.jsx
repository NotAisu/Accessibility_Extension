import markdownStyles from "./markdown-styles.module.css";

export default function PostBody({ content }) {
  return (
    <div role="checkbox" className="max-w-2xl mx-auto">
      <div
        className={markdownStyles["markdown"]}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  );
}
