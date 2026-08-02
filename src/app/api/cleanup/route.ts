import { NextResponse } from "next/server";
import { readdir, readFile, unlink, rmdir } from "fs/promises";
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

// POST /api/cleanup — Remove expired and burned secrets
export async function POST() {
  const now = Date.now();
  const deleted: string[] = [];

  try {
    const dirs = await readdir(STORE_DIR);
    for (const id of dirs) {
      try {
        const raw = await readFile(join(STORE_DIR, id, "meta.json"), "utf-8");
        const meta: SecretMeta = JSON.parse(raw);

        if (meta.expiresAt < now || meta.burned) {
          try { await unlink(join(STORE_DIR, id, "meta.json")); } catch {}
          try { await rmdir(join(STORE_DIR, id)); } catch {}
          deleted.push(id);
        }
      } catch {
        // Orphaned dir
        try { await rmdir(join(STORE_DIR, id)); } catch {}
      }
    }
  } catch {
    // Store dir doesn't exist
  }

  return NextResponse.json({ deleted, timestamp: now });
}