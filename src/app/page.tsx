import { currentAccount } from "@/lib/auth";
import { Landing } from "@/components/landing";
import { enrollUrl } from "@/lib/oidc";
import { Tool } from "./tool";

/**
 * The front door, decided on the server: a stranger gets the landing page,
 * somebody signed in gets the tool for creating secrets.
 *
 * Opening a secret does not come through here at all — /v/[id] is public, and
 * has to be: whoever receives a link is by definition somebody without an
 * account.
 *
 * force-dynamic because this reads the session cookie.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const account = await currentAccount();
  if (!account) return <Landing enrollUrl={enrollUrl()} />;
  return <Tool />;
}
