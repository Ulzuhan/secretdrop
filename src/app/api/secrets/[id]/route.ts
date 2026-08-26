import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink, rmdir } from "fs/promises";
import { join } from "path";

const STORE_DIR = join(process.cwd(), ".secretdrop-store");

interface SecretMeta {
  id: string;
  ciphertext: string;
  iv: string;
  expiresAt: number;
  maxViews: number;
  viewCount: number;
  createdAt: number;
  burned: boolean;
}

const globalStore = globalThis as typeof globalThis & {
  __secretdrop_store__?: Map<string, SecretMeta>;
};

function getStore(): Map<string, SecretMeta> {
  globalStore.__secretdrop_store__ ??= new Map();
  return globalStore.__secretdrop_store__;
}

async function loadMeta(id: string): Promise<SecretMeta | null> {
  const store = getStore();
  if (store.has(id)) return store.get(id)!;

  try {
    const raw = await readFile(join(STORE_DIR, id, "meta.json"), "utf-8");
    const meta: SecretMeta = JSON.parse(raw);
    store.set(id, meta);
    return meta;
  } catch {
    return null;
  }
}

async function deleteSecret(id: string) {
  try { await unlink(join(STORE_DIR, id, "meta.json")); } catch {}
  try { await rmdir(join(STORE_DIR, id)); } catch {}
  getStore().delete(id);
}

// ─── GET /api/secrets/[id] — Retrieve & burn a secret ───────────────
// Returns the ciphertext + IV ONLY. The decryption key comes from the URL fragment
// and is never sent to the server. After maxViews is reached, the secret is burned.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    await writeFile(join(STORE_DIR, id, "meta.json"), JSON.stringify(meta, null, 2));
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