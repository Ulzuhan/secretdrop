import { NextResponse } from "next/server";
import { consumeSecret, idValido } from "@/lib/store";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const ERROR_STATUS = {
  not_found: 404,
  expired: 410,
  burned: 410,
  storage_error: 503,
} as const;

const ERROR_TEXT = {
  not_found: "Secret not found",
  expired: "Secret expired",
  burned: "Secret already burned",
  storage_error: "Secret could not be consumed safely",
} as const;

/**
 * Public capability endpoint. The id is the server-side half of the credential; the
 * decryption key stays in the URL fragment and never reaches this handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const limited = rateLimit("read:" + clientIp(_request), 120, 60_000);
  if (limited) return limited;
  if (!idValido(id)) {
    return NextResponse.json({ error: ERROR_TEXT.not_found }, { status: 404 });
  }

  const result = await consumeSecret(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: ERROR_TEXT[result.reason] },
      { status: ERROR_STATUS[result.reason] }
    );
  }

  const meta = result.meta;
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
