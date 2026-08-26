"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { decryptSecret } from "@/lib/crypto";

interface SecretData {
  id: string;
  ciphertext: string;
  iv: string;
  expiresAt: number;
  maxViews: number;
  viewCount: number;
  burned: boolean;
}

type State = "loading" | "ready" | "decrypted" | "burned" | "expired" | "error";

function formatExpiry(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function ViewSecretPage() {
  const params = useParams();
  const id = params.id as string;

  const [state, setState] = useState<State>("loading");
  const [secretData, setSecretData] = useState<SecretData | null>(null);
  const [plaintext, setPlaintext] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [hasKey, setHasKey] = useState(true);

  const fetchAndDecrypt = useCallback(async (key: string) => {
    try {
      // 1. Fetch the encrypted secret from the server
      const res = await fetch(`/api/secrets/${id}`);

      if (res.status === 410) {
        const data = await res.json();
        setState("burned");
        setErrorMsg(data.error || "This secret has been burned");
        return;
      }

      if (res.status === 404) {
        setState("expired");
        setErrorMsg("Secret not found. It may have expired or been deleted.");
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setState("error");
        setErrorMsg(data.error || "Failed to retrieve secret");
        return;
      }

      const data: SecretData = await res.json();
      setSecretData(data);
      setState("ready");

      // 2. Auto-decrypt immediately — the key is already in the browser
      try {
        const decrypted = await decryptSecret(data.ciphertext, data.iv, key);
        setPlaintext(decrypted);
        setState("decrypted");
      } catch (decryptErr) {
        setState("error");
        setErrorMsg("Decryption failed. The link may be corrupted or the key is invalid.");
        console.error("Decrypt error:", decryptErr);
      }
    } catch (err) {
      setState("error");
      setErrorMsg("Network error. Please check your connection and try again.");
      console.error("Fetch error:", err);
    }
  }, [id]);

  useEffect(() => {
    // Read the key and start fetching from a macrotask, not the effect body,
    // so the first paint isn't blocked by a synchronous state update
    // (react-hooks/set-state-in-effect).
    const kickoff = setTimeout(() => {
      // Extract the decryption key from the URL fragment (#key)
      // The fragment is NEVER sent to the server — it only exists in the browser
      const hash = window.location.hash.slice(1); // Remove the #

      if (!hash) {
        setHasKey(false);
        setState("error");
        setErrorMsg("No decryption key found in the URL. The link may be incomplete or corrupted.");
        return;
      }

      void fetchAndDecrypt(hash);
    }, 0);

    return () => clearTimeout(kickoff);
  }, [fetchAndDecrypt]);

  function copySecret() {
    navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ─── Loading ──────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <div className="text-center space-y-3">
          <div className="text-4xl animate-pulse">🔐</div>
          <p className="text-muted">Retrieving encrypted secret...</p>
        </div>
      </div>
    );
  }

  // ─── Error (no key, network error, etc.) ───────────────────────────
  if (state === "error") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-md w-full space-y-4">
          <div className="text-5xl">⚠️</div>
          <h2 className="text-xl font-bold text-foreground">Something went wrong</h2>
          <p className="text-muted">{errorMsg}</p>
          {!hasKey && (
            <p className="text-xs text-muted bg-surface-light rounded-xl p-3">
              The shareable link should look like: <br />
              <code className="text-accent">/v/xxxxx#KEY</code> <br />
              Ask the sender to copy the complete link.
            </p>
          )}
          <Link
            href="/"
            className="inline-block bg-accent hover:bg-accent-hover text-white font-medium py-2.5 px-6 rounded-xl transition-all"
          >
            Create a New Secret
          </Link>
        </div>
      </div>
    );
  }

  // ─── Burned (already viewed max times) ─────────────────────────────
  if (state === "burned") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-md w-full space-y-4">
          <div className="text-5xl">🔥</div>
          <h2 className="text-xl font-bold text-foreground">Secret Burned</h2>
          <p className="text-muted">
            This secret has already been viewed the maximum number of times and has been permanently deleted.
          </p>
          <p className="text-muted text-sm">
            🔥 Burn after read — your security guarantee.
          </p>
          <Link
            href="/"
            className="inline-block bg-accent hover:bg-accent-hover text-white font-medium py-2.5 px-6 rounded-xl transition-all"
          >
            Create a New Secret
          </Link>
        </div>
      </div>
    );
  }

  // ─── Expired ───────────────────────────────────────────────────────
  if (state === "expired") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center max-w-md w-full space-y-4">
          <div className="text-5xl">⌛</div>
          <h2 className="text-xl font-bold text-foreground">Secret Expired</h2>
          <p className="text-muted">{errorMsg}</p>
          <Link
            href="/"
            className="inline-block bg-accent hover:bg-accent-hover text-white font-medium py-2.5 px-6 rounded-xl transition-all"
          >
            Create a New Secret
          </Link>
        </div>
      </div>
    );
  }

  // ─── Decrypted (success!) ─────────────────────────────────────────
  if (state === "decrypted" && plaintext) {
    const isLastView = secretData?.viewCount === secretData?.maxViews;

    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] px-4 py-8">
        <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8 max-w-lg w-full space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="text-4xl">{isLastView ? "🔥" : "🔓"}</div>
            <h2 className="text-xl font-bold text-foreground">Your Secret</h2>
            <p className="text-muted text-sm">
              {isLastView
                ? "⚠️ This was the last allowed view — the secret has been burned."
                : `View ${secretData?.viewCount} of ${secretData?.maxViews}`}
            </p>
          </div>

          {/* Secret Content */}
          <div className="bg-surface-light rounded-xl p-4 border border-border/50">
            <pre className="text-foreground font-mono text-sm whitespace-pre-wrap break-all select-all">
              {plaintext}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={copySecret}
              className="flex-1 bg-accent hover:bg-accent-hover text-white font-medium py-3 px-5 rounded-xl transition-all active:scale-95"
            >
              {copied ? "✓ Copied!" : "📋 Copy Secret"}
            </button>
          </div>

          {/* Meta info */}
          {secretData && (
            <div className="bg-surface-light/50 rounded-xl p-3 space-y-1.5 text-xs text-muted">
              <div className="flex justify-between">
                <span>Expires in</span>
                <span className="text-foreground font-medium">{formatExpiry(secretData.expiresAt)}</span>
              </div>
              <div className="flex justify-between">
                <span>Views remaining</span>
                <span className="text-foreground font-medium">
                  {secretData.maxViews - secretData.viewCount}
                </span>
              </div>
            </div>
          )}

          {/* Security notice */}
          {isLastView && (
            <div className="text-center text-xs text-warning bg-warning/10 border border-warning/20 rounded-xl p-3">
              🔥 This secret has been permanently deleted from the server.
              <br />
              Copy it now if you need it — it cannot be retrieved again.
            </div>
          )}

          <Link
            href="/"
            className="block text-center text-muted hover:text-foreground transition-colors text-sm"
          >
            Create your own encrypted secret →
          </Link>
        </div>
      </div>
    );
  }

  // ─── Ready (fetching, before decrypt) ─────────────────────────────
  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <div className="text-center space-y-3">
        <div className="text-4xl animate-pulse">🔓</div>
        <p className="text-muted">Decrypting...</p>
      </div>
    </div>
  );
}