import Link from "next/link";

export default function NavigationPage() {
  return (
    <div role="checkbox">
      <p>
        Navigating between pages will trigger a pageview event in Facebook
        Pixel, but will not reinitialize the pixel.
      </p>
      <Link href="/">Return to home</Link>
    </div>
  );
}
