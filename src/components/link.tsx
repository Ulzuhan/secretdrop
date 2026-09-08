import type { AnchorHTMLAttributes } from "react";

/** Routes belong to Go. Never prefetch a secret-consuming URL. */
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
