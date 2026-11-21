import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

/** Any address this site does not serve. Says so, and offers the ways back. */
export default function NotFound() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Error 404</span>
        <h1 className="h2">This page does not exist</h1>
        <p className="body">The address may be mistyped, or the page may have moved. Nothing was sent or changed.</p>
        <div className="actions">
          <Link className="btn" href="/">
            Home
          </Link>
          <Link className="link" href="/explore">
            Explore coins
          </Link>
          <Link className="link" href="/docs">
            Docs
          </Link>
        </div>
      </div>
    </div>
  );
}
