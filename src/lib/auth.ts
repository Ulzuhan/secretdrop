/**
 * SecretDrop — who is allowed to CREATE secrets.
 *
 * The asymmetry is the whole design: making a secret needs an account, opening
 * one does not. Whoever you send a link to is, by definition, somebody without
 * an account here — asking them to get one would defeat the point of the tool.
 * So the sign-in guards the writing side only; /v/<id> stays open to anyone
 * holding the link.
 *
 * There is no user store because there is nothing to file under a name: the
 * server never sees the plaintext (it is encrypted in the browser before it is
 * sent), so a session is just a signed cookie carrying the identity Authentik
 * vouched for.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { oidcConfigured, type OidcIdentity } from "@/lib/oidc";

export const SESSION_COOKIE = "secretdrop_session";
const configuredTtlHours = Number(process.env.SECRETDROP_SESSION_TTL_HOURS ?? 12);
const SESSION_TTL_HOURS = Number.isFinite(configuredTtlHours)
  ? Math.min(24, Math.max(1, configuredTtlHours))
  : 12;
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

export interface Account {
  sub: string;
  email: string;
  name?: string;
}

function secret(): string | null {
  const value = process.env.SECRETDROP_SESSION_SECRET?.trim();
  return value && Buffer.byteLength(value, "utf8") >= 32 ? value : null;
}

/** Without a signing secret and an OIDC client, nobody can get in at all. */
export function isConfigured(): boolean {
  return Boolean(secret() && oidcConfigured());
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueToken(identity: OidcIdentity): string | null {
  const key = secret();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ ...identity, exp: Date.now() + SESSION_TTL_MS })
  ).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function readToken(token: string | undefined): Account | null {
  const key = secret();
  if (!key || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload, key);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Constant time: a normal comparison leaks the signature byte by byte
  // through how long it takes to answer.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof claims.exp !== "number" || claims.exp <= Date.now()) return null;
    if (typeof claims.sub !== "string" || typeof claims.email !== "string") return null;
    return { sub: claims.sub, email: claims.email, name: claims.name };
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

export async function currentAccount(): Promise<Account | null> {
  const store = await cookies();
  return readToken(store.get(SESSION_COOKIE)?.value);
}

export async function startSession(identity: OidcIdentity): Promise<void> {
  const token = issueToken(identity);
  if (!token) throw new Error("SECRETDROP_SESSION_SECRET is not set");
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions);
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** For the API routes: null to proceed, or the 401 to return. */
export async function requireAccount(): Promise<Response | null> {
  if (await currentAccount()) return null;
  return Response.json({ error: "Sign in to use this" }, { status: 401 });
}
