/**
 * La API, tipada. Sólo viaja criptograma: la clave y el texto claro no pasan
 * por aquí jamás.
 */

export interface SecretSummary {
  id: string;
  expiresAt: number;
  maxViews: number;
  viewCount: number;
  createdAt: number;
}

export interface CreatedSecret {
  id: string;
  expiresAt: number;
  maxViews: number;
}

export interface SecretPayload {
  id: string;
  ciphertext: string;
  iv: string;
  expiresAt: number;
  maxViews: number;
  viewCount: number;
  burned: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorOf(res: Response, fallback: string): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const message = body && typeof body.error === "string" ? body.error : fallback;
  return new ApiError(message, res.status);
}

export async function listSecrets(): Promise<SecretSummary[]> {
  const res = await fetch("/api/secrets", { headers: { accept: "application/json" } });
  if (!res.ok) throw await errorOf(res, "Could not load your secrets");
  const data = await res.json();
  return Array.isArray(data?.secrets) ? data.secrets : [];
}

export async function createSecret(body: {
  ciphertext: string;
  iv: string;
  ttlHours: number;
  maxViews: number;
}): Promise<CreatedSecret> {
  const res = await fetch("/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorOf(res, "Could not create the secret");
  return res.json();
}

export type Fetched =
  | { kind: "ok"; data: SecretPayload }
  | { kind: "burned" | "expired" | "missing" | "error"; message: string };

/**
 * Consume UNA vista. Se llama sólo con clave en mano: pedir el criptograma
 * gasta el secreto aunque luego no se pueda descifrar.
 */
export async function fetchSecret(id: string): Promise<Fetched> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
  });
  if (res.ok) return { kind: "ok", data: await res.json() };
  const err = await errorOf(res, "Could not retrieve the secret");
  if (res.status === 404) return { kind: "missing", message: err.message };
  if (res.status === 410) {
    return /expired/i.test(err.message)
      ? { kind: "expired", message: err.message }
      : { kind: "burned", message: err.message };
  }
  return { kind: "error", message: err.message };
}

export async function signOut(): Promise<string> {
  const res = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  const next = res ? (await res.json().catch(() => ({}))).next : null;
  return typeof next === "string" && next ? next : "/";
}
