import { NextRequest, NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { cleanupExpired } from "@/lib/store";
import { isSameOriginMutation } from "@/lib/request-origin";

/**
 * POST /api/cleanup — purga caducados y quemados.
 *
 * Ahora exige cuenta. Antes era público: recorría el almacén entero leyendo
 * ficheros en cada llamada, así que bastaba con repetirla para generar picos de
 * disco sin tener nada. No exponía secretos, pero era trabajo gratis para quien
 * lo encontrara.
 *
 * La purga real vive en `lib/store`. Antes estaba aquí duplicada y **borraba
 * del disco sin tocar la caché en memoria**: un secreto purgado podía seguir
 * sirviéndose desde RAM hasta que el proceso se reiniciara, que es justo lo
 * contrario de lo que promete esta herramienta.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
  const unauthorized = await requireAccount();
  if (unauthorized) return unauthorized;

  const borrados = await cleanupExpired();
  return NextResponse.json({ deleted: borrados, timestamp: Date.now() });
}
