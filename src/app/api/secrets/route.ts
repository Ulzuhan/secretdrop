import { NextRequest, NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { cleanupExpired, enRango, getStore, nuevoId, saveMeta, type SecretMeta } from "@/lib/store";

// ─── Startup cleanup ────────────────────────────────────────────────
cleanupExpired();

/**
 * Tope del criptograma.
 *
 * No había ninguno: quien tuviera cuenta podía mandar decenas de megas por
 * petición, que se cargan enteros en memoria y se escriben en disco. 256 KB de
 * base64 son ~192 KB en claro, de sobra para lo que esto es —una contraseña,
 * una clave, un código de recuperación— y muy lejos de poder tumbar el proceso.
 */
const MAX_CIPHERTEXT = 256 * 1024;
const MAX_IV = 256;


// ─── POST /api/secrets — Create a secret ────────────────────────────
export async function POST(request: NextRequest) {
  // Crear exige cuenta; leer no —eso vive en
  // /api/secrets/[id] — porque quien recibe el enlace no tiene por qué tenerla.
  const unauthorized = await requireAccount();
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const { ciphertext, iv, ttlHours, maxViews } = body as {
      ciphertext?: unknown;
      iv?: unknown;
      ttlHours?: unknown;
      maxViews?: unknown;
    };

    if (typeof ciphertext !== "string" || typeof iv !== "string" || !ciphertext || !iv) {
      return NextResponse.json({ error: "Missing ciphertext or iv" }, { status: 400 });
    }
    if (ciphertext.length > MAX_CIPHERTEXT || iv.length > MAX_IV) {
      return NextResponse.json({ error: "Secret too large" }, { status: 413 });
    }

    const ttl = enRango(ttlHours, 1, 168, 24); // 1h a 7d
    const views = enRango(maxViews, 1, 10, 1); // 1 a 10 lecturas

    const id = nuevoId();
    const meta: SecretMeta = {
      id,
      ciphertext,
      iv,
      expiresAt: Date.now() + ttl * 60 * 60 * 1000,
      maxViews: views,
      viewCount: 0,
      createdAt: Date.now(),
      burned: false,
    };

    await saveMeta(meta);

    return NextResponse.json({
      id,
      expiresAt: meta.expiresAt,
      maxViews: meta.maxViews,
    });
  } catch (error) {
    console.error("Create secret error:", error);
    return NextResponse.json({ error: "Failed to create secret" }, { status: 500 });
  }
}

// ─── GET /api/secrets — List active secrets (metadata only, no ciphertext) ─
export async function GET() {
  // El listado enseña los secretos vivos de esta instancia: solo con cuenta.
  const unauthorized = await requireAccount();
  if (unauthorized) return unauthorized;

  const now = Date.now();
  const store = getStore();
  const secrets = Array.from(store.values())
    .filter((s) => s.expiresAt > now && !s.burned)
    .map((s) => ({
      id: s.id,
      expiresAt: s.expiresAt,
      maxViews: s.maxViews,
      viewCount: s.viewCount,
      createdAt: s.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

  return NextResponse.json({ secrets });
}
