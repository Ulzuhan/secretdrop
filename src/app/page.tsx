"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { generateKey, encryptSecret } from "@/lib/crypto";

function formatExpiry(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface SecretInfo {
  id: string;
  expiresAt: number;
  maxViews: number;
  viewCount: number;
  createdAt: number;
}

interface CreatedSecret {
  id: string;
  url: string;
  expiresAt: number;
  maxViews: number;
}

export default function Home() {
  const [secret, setSecret] = useState("");
  const [ttl, setTtl] = useState(24);
  const [maxViews, setMaxViews] = useState(1);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch("/api/secrets");
      if (res.ok) {
        const data = await res.json();
        setSecrets(data.secrets);
      }
    } catch {}
    setLoadingList(false);
  }, []);

  useEffect(() => {
    fetchSecrets();
    const interval = setInterval(fetchSecrets, 10000);
    return () => clearInterval(interval);
  }, [fetchSecrets]);

  const createSecret = useCallback(async () => {
    if (!secret.trim()) {
      setError("Please enter a secret to encrypt");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // 1. Generate random 256-bit key (client-side only)
      const key = generateKey();

      // 2. Encrypt the secret with AES-256-GCM
      const { ciphertext, iv } = await encryptSecret(secret, key);

      // 3. Send ONLY ciphertext + IV to server (key stays in browser)
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciphertext, iv, ttlHours: ttl, maxViews }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create secret");
      }

      const data = await res.json();

      // 4. Build the shareable URL: /v/{id}#key
      // The key is in the URL fragment (#), which browsers NEVER send to servers
      const shareUrl = `/v/${data.id}#${key}`;

      setResult({
        id: data.id,
        url: shareUrl,
        expiresAt: data.expiresAt,
        maxViews: data.maxViews,
      });

      setSecret("");
      fetchSecrets();
    } catch (err: any) {
      setError(err.message || "Failed to create secret");
    } finally {
      setCreating(false);
    }
  }, [secret, ttl, maxViews, fetchSecrets]);

  const copyLink = async (url: string) => {
    const fullUrl = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setResult(null);
    setError(null);
    if (textareaRef.current) textareaRef.current.value = "";
  };

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8 sm:py-12 max-w-2xl mx-auto w-full">
      {/* Logo / Brand */}
      <div className="text-center mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold mb-2">
          <span className="text-accent">Secret</span>Drop
        </h1>
        <p className="text-muted text-sm sm:text-base">
          Share secrets with end-to-end encryption. Burns after reading. 🔐🔥
        </p>
      </div>

      {/* Create Form */}
      {!result && (
        <div className="w-full mb-8 space-y-4">
          {/* Secret Input */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              Your secret (password, token, API key,...)
            </label>
            <textarea
              ref={textareaRef}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste your secret here..."
              rows={5}
              className="w-full bg-surface border border-border rounded-2xl p-4 text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all resize-none font-mono text-sm"
            />
            <p className="text-xs text-muted mt-1.5">
              🔒 Encrypted in your browser with AES-256-GCM. The key never touches the server.
            </p>
          </div>

          {/* TTL Selector */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              Self-destruct after
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { h: 1, label: "1h" },
                { h: 6, label: "6h" },
                { h: 24, label: "24h" },
                { h: 72, label: "3d" },
                { h: 168, label: "7d" },
              ].map(({ h, label }) => (
                <button
                  key={h}
                  onClick={() => setTtl(h)}
                  className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${
                    ttl === h
                      ? "bg-accent text-white"
                      : "bg-surface-light text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Max Views */}
          <div>
            <label className="block text-sm font-medium text-muted mb-2">
              Max views before burn
            </label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 5, 10].map((v) => (
                <button
                  key={v}
                  onClick={() => setMaxViews(v)}
                  className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${
                    maxViews === v
                      ? "bg-accent text-white"
                      : "bg-surface-light text-muted hover:text-foreground"
                  }`}
                >
                  {v}x
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm text-center">
              {error}
            </div>
          )}

          {/* Create Button */}
          <button
            onClick={createSecret}
            disabled={creating || !secret.trim()}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 px-5 rounded-xl transition-all active:scale-95"
          >
            {creating ? "🔐 Encrypting..." : "✨ Create Encrypted Link"}
          </button>
        </div>
      )}

      {/* Result Card */}
      {result && (
        <div className="w-full space-y-4 mb-8">
          <div className="bg-surface border border-border rounded-2xl p-6 text-center space-y-4">
            <div className="text-4xl">✅</div>
            <div>
              <p className="text-foreground font-semibold text-lg">
                Secret encrypted & ready to share
              </p>
              <p className="text-muted text-sm mt-1">
                Expires in {formatExpiry(result.expiresAt)} · Burns after {result.maxViews} view{result.maxViews !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => copyLink(result.url)}
                className="flex-1 bg-accent hover:bg-accent-hover text-white font-medium py-3 px-5 rounded-xl transition-all active:scale-95"
              >
                {copied ? "✓ Copied!" : "📋 Copy Link"}
              </button>
              <button
                onClick={reset}
                className="flex-1 bg-surface-light hover:bg-border text-foreground font-medium py-3 px-5 rounded-xl transition-all"
              >
                ✨ New Secret
              </button>
            </div>

            <div className="bg-surface-light rounded-xl p-3 font-mono text-sm text-accent break-all select-all">
              {typeof window !== "undefined"
                ? `${window.location.origin}${result.url}`
                : result.url}
            </div>
            <p className="text-xs text-muted">
              ⚠️ The decryption key is in the URL fragment (#). Share this link only with the intended recipient.
            </p>
          </div>
        </div>
      )}

      {/* Active Secrets List */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            🔑 Active Secrets
          </h2>
          <button
            onClick={fetchSecrets}
            className="text-muted hover:text-foreground transition-colors text-sm"
          >
            ↻ Refresh
          </button>
        </div>

        {loadingList ? (
          <div className="text-center text-muted py-8">
            <div className="text-2xl mb-2">⏳</div>
            Loading...
          </div>
        ) : secrets.length === 0 ? (
          <div className="text-center text-muted py-8 bg-surface rounded-2xl border border-border">
            <div className="text-3xl mb-2">📭</div>
            <p>No active secrets</p>
            <p className="text-sm mt-1">Create one above to share securely</p>
          </div>
        ) : (
          <div className="space-y-2">
            {secrets.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-4 p-4 bg-surface border border-border rounded-xl group"
              >
                <div className="text-2xl flex-shrink-0">🔐</div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-medium truncate font-mono text-sm">
                    /v/{s.id}
                  </p>
                  <p className="text-muted text-sm mt-0.5">
                    {timeAgo(s.createdAt)} · {s.viewCount}/{s.maxViews} views
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="inline-block px-2.5 py-1 text-xs font-medium rounded-full bg-success/10 text-success">
                    {formatExpiry(s.expiresAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Security Info Footer */}
      <div className="w-full mt-8 p-4 bg-surface/50 border border-border/50 rounded-xl text-xs text-muted space-y-2">
        <p className="font-medium text-foreground/80">🛡️ How it works</p>
        <p>• Your secret is encrypted <strong>in your browser</strong> with AES-256-GCM before it ever touches the server.</p>
        <p>• The decryption key lives in the URL fragment (<code className="text-accent">#key</code>), which browsers <strong>never send</strong> to the server.</p>
        <p>• The server only stores the encrypted ciphertext + IV — it cannot read your secret.</p>
        <p>• After the max view count is reached, the secret is <strong>permanently deleted</strong>.</p>
        <p>• Expired secrets are automatically cleaned up.</p>
      </div>
    </div>
  );
}