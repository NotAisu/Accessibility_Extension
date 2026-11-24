import Link from "next/link";

export default function About() {
  return (
    <div aria-labeledby="title">
      This is a static page goto <Link href="/">dynamic</Link> page.
    </div>
  );
}
