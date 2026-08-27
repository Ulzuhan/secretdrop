import { NextRequest, NextResponse } from "next/server";
import { deleteSecret, idValido, loadMeta, saveMeta } from "@/lib/store";

// ─── GET /api/secrets/[id] — Retrieve & burn a secret ───────────────
// Returns the ciphertext + IV ONLY. The decryption key comes from the URL fragment
// and is never sent to the server. After maxViews is reached, the secret is burned.
//
// Deliberadamente SIN sesión: quien recibe el enlace no tiene por qué tener
// cuenta. Por eso mismo la validación del `id` de abajo no es opcional — todo lo
// que hay detrás es alcanzable desde internet por cualquiera.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // El `id` se concatenaba con `join(STORE_DIR, id, …)` sin comprobar nada.
  // Con `%2e%2e%2f` repetido se salía del almacén: lectura de cualquier
  // `meta.json` del sistema y, si su fecha estaba vencida, borrado del fichero
  // y `rmdir` de su carpeta. Sin sesión. Ver la explicación larga en lib/store.
  if (!idValido(id)) {
    // Misma respuesta que un id inexistente: no hay motivo para distinguir
    // "mal formado" de "no existe" ante quien está probando.
    return NextResponse.json({ error: "Secret not found" }, { status: 404 });
  }

  const meta = await loadMeta(id);

  if (!meta) {
    return NextResponse.json({ error: "Secret not found" }, { status: 404 });
  }

  // Check expiry
  if (meta.expiresAt < Date.now()) {
    await deleteSecret(id);
    return NextResponse.json({ error: "Secret expired" }, { status: 410 });
  }

  // Check burn status
  if (meta.burned) {
    return NextResponse.json({ error: "Secret already burned" }, { status: 410 });
  }

  // Increment view count
  meta.viewCount++;

  // Check if this view burns it
  if (meta.viewCount >= meta.maxViews) {
    meta.burned = true;
  }

  // Persist updated metadata
  try {
    await saveMeta(meta);
  } catch {
    // Disk write failed, but in-memory is updated — still serve the secret
    console.error("Failed to persist meta for", id);
  }

  // If burned, schedule deletion (fire-and-forget)
  if (meta.burned) {
    // Give the response a moment to be sent, then delete
    setTimeout(async () => {
      await deleteSecret(id);
    }, 1000);
  }

  // Return ciphertext + IV — client decrypts with key from URL fragment
  return NextResponse.json({
    id: meta.id,
    ciphertext: meta.ciphertext,
    iv: meta.iv,
    expiresAt: meta.expiresAt,
    maxViews: meta.maxViews,
    viewCount: meta.viewCount,
    burned: meta.burned,
  });
}
