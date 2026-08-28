import type { Metadata } from "next";

/**
 * A secret's page must never reach a search index.
 *
 * The identifier in the path is what grants access, and reading a one-time
 * secret consumes it: an indexed link is both a leak and a secret burned by a
 * crawler instead of by the person it was meant for. `robots.txt` disallows
 * `/v/` as well — two layers, because this one is worth two.
 *
 * It lives in a layout because the page itself is a client component (the
 * decryption happens in the browser), and those cannot export metadata.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ViewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
