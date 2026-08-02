import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readdir, readFile, unlink, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const STORE_DIR = join(process.cwd(), ".secretdrop-store");

// ─── Types ──────────────────────────────────────────────────────────
interface SecretMeta {
  id: string;
  ciphertext: string;      // AES-256-GCM encrypted (base64)
  iv: string;              // Initialization vector (base64)
  expiresAt: number;       // Timestamp when secret expires
  maxViews: number;        // Max times the secret can be viewed (default 1)
  viewCount: number;       // How many times it's been viewed
  createdAt: number;
  burned: boolean;         // True after maxViews reached
}

// ─── In-memory cache (for speed) backed by disk (for persistence) ─
function getStore(): Map<string, SecretMeta> {
  if (!(globalThis as any).__secretdrop_store__) {
    (globalThis as any).__secretdrop_store__ = new Map();
  }
  return (globalThis as any).__secretdrop_store__;
}

// ─── Startup cleanup ────────────────────────────────────────────────
async function cleanupExpired() {
  if (!existsSync(STORE_DIR)) return;
  const now = Date.now();
  const store = getStore();

  try {
    const dirs = await readdir(STORE_DIR);
    for (const id of dirs) {
      try {
        const raw = await readFile(join(STORE_DIR, id, "meta.json"), "utf-8");
        const meta: SecretMeta = JSON.parse(raw);
        if (meta.expiresAt < now || meta.burned) {
          await deleteSecret(id);
        } else {
          store.set(id, meta);
        }
      } catch {
        // Orphaned dir
        try { await rmdir(join(STORE_DIR, id)); } catch {}
      }
    }
  } catch {}
}

async function deleteSecret(id: string) {
  try { await unlink(join(STORE_DIR, id, "meta.json")); } catch {}
  try { await rmdir(join(STORE_DIR, id)); } catch {}
  getStore().delete(id);
}

// Run cleanup on module load
cleanupExpired();

// ─── POST /api/secrets — Create a new secret ────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ciphertext, iv, ttlHours, maxViews } = body as {
      ciphertext: string;
      iv: string;
      ttlHours?: number;
      maxViews?: number;
    };

    // Validate
    if (!ciphertext || !iv) {
      return NextResponse.json({ error: "Missing ciphertext or iv" }, { status: 400 });
    }

    const ttl = Math.min(Math.max(ttlHours ?? 24, 1), 168); // 1h to 7d max
    const views = Math.min(Math.max(maxViews ?? 1, 1), 10);  // 1 to 10 views max

    const id = randomBytes(9).toString("base64url"); // ~12 chars URL-safe
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

    // Persist to disk
    await mkdir(join(STORE_DIR, id), { recursive: true });
    await writeFile(join(STORE_DIR, id, "meta.json"), JSON.stringify(meta, null, 2));
    getStore().set(id, meta);

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