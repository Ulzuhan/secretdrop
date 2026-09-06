import { NextRequest, NextResponse } from "next/server";
import { currentAccount, requireAccount } from "@/lib/auth";
import { jsonBody } from "@/lib/body";
import { cleanupExpired, enRango, getStore, nuevoId, saveNewMeta, type SecretMeta } from "@/lib/store";
import { clientIp, rateLimit } from "@/lib/ratelimit";

// ─── Startup cleanup ────────────────────────────────────────────────
//
// Este barrido es además lo que llena el índice en memoria: recorre el almacén
// con `loadMeta()`, que cachea. El listado sale de ese índice, así que hasta que
// termina hay secretos en disco que aún no están en él.
//
// Lanzarlo sin esperarlo dejaba esa ventana abierta a la primera petición: con
// 2000 registros sembrados antes de arrancar, el primer listado devolvió 1606.
// No es pérdida de datos —los enlaces van por id y leen disco— pero a alguien
// le faltan secretos de su lista justo después de un despliegue, y minutos
// después están. Con 1000 no se reprodujo: es una carrera, no un umbral.
//
// Se guarda la promesa y el listado la espera. Se ejecuta una sola vez por
// proceso, y `catch` para que un fallo del barrido no tumbe cada petición.
const arranque = cleanupExpired().catch(() => 0);

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
  const limited = rateLimit("create:" + clientIp(request), 60, 60 * 60 * 1000);
  if (limited) return limited;
  // Crear exige cuenta; leer no —eso vive en
  // /api/secrets/[id] — porque quien recibe el enlace no tiene por qué tenerla.
  const unauthorized = await requireAccount();
  if (unauthorized) return unauthorized;

  try {
    const body = await jsonBody(request);
    if (!body) {
      return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
    }
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
    const cuenta = await currentAccount();
    const meta: SecretMeta = {
      id,
      ciphertext,
      iv,
      // De quién es: decide qué listado lo enseña, y nada más — leerlo sigue
      // sin pedir cuenta, porque quien recibe el enlace no tiene por qué tenerla.
      owner: cuenta?.sub,
      expiresAt: Date.now() + ttl * 60 * 60 * 1000,
      maxViews: views,
      viewCount: 0,
      createdAt: Date.now(),
      burned: false,
    };

    if ((await saveNewMeta(meta)) === "quota") {
      return NextResponse.json({ error: "Secret store is full" }, { status: 507 });
    }

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
  const unauthorized = await requireAccount();
  if (unauthorized) return unauthorized;

  // TUS secretos vivos, no los de la instancia. Esto listaba todos a cualquiera
  // con cuenta, y el id que enseñaba es la mitad servidor de la capacidad: con
  // él se puede CONSUMIR el secreto —leerlo cuenta la vista y lo quema— aunque
  // no descifrarlo. O sea que cualquier cuenta podía destruir los secretos de
  // las demás y ver cuántos había. Los anteriores al campo `owner` no se
  // enseñan a nadie: sus enlaces funcionan y caducan solos (7 días como mucho).
  const cuenta = await currentAccount();
  // Sin esto el listado puede salir corto mientras el índice se está llenando.
  await arranque;
  const now = Date.now();
  const store = getStore();
  const secrets = Array.from(store.values())
    .filter((s) => s.expiresAt > now && !s.burned && s.owner && s.owner === cuenta?.sub)
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
