import { useCallback, useEffect, useState } from "react";
import { Assurances } from "../components/assurances";
import { Composer } from "../components/composer";
import { ShareResult, type ShareableSecret } from "../components/share-result";
import { Vault } from "../components/vault";
import { createSecret, listSecrets, type SecretSummary } from "../lib/api";
import { encryptSecret, generateKey } from "../lib/crypto";
import { Icon } from "../ui/icons";

/**
 * La herramienta: crear un secreto y ver los que siguen vivos. Todo el
 * cifrado ocurre aquí, en `createOne`, antes de que salga una sola petición.
 */
export function Tool() {
  const [secret, setSecret] = useState("");
  const [ttl, setTtl] = useState(24);
  const [views, setViews] = useState(1);
  const [encrypting, setEncrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareableSecret | null>(null);
  const vault = useVault();

  const createOne = useCallback(async () => {
    if (!secret.trim() || encrypting) return;
    setEncrypting(true);
    setError(null);
    const started = performance.now();
    try {
      // 1. Una clave de 256 bits, sólo en este navegador.
      const key = generateKey();
      // 2. AES-256-GCM aquí mismo.
      const { ciphertext, iv } = await encryptSecret(secret, key);
      // 3. Al servidor van criptograma e IV. La clave, jamás.
      const created = await createSecret({ ciphertext, iv, ttlHours: ttl, maxViews: views });
      // El teatro del cifrado dura 650 ms; si el servidor contesta antes, se
      // espera a que termine para que la pantalla no salte a medias.
      const remaining = 700 - (performance.now() - started);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      // 4. El enlace: la clave viaja en el fragmento, que el navegador no envía.
      setResult({
        id: created.id,
        url: `${window.location.origin}/v/${created.id}#${key}`,
        expiresAt: created.expiresAt,
        maxViews: created.maxViews,
      });
      setSecret("");
      void vault.refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the secret");
    } finally {
      setEncrypting(false);
    }
  }, [secret, ttl, views, encrypting, vault]);

  const reset = () => {
    setResult(null);
    setError(null);
    setSecret("");
  };

  const live = vault.items?.length ?? 0;
  const unopened = vault.items?.filter((s) => s.viewCount === 0).length ?? 0;

  return (
    <main className="container workspace">
      <div className="workspace-head">
        <div>
          <p className="eyebrow rise" style={{ "--i": 0 } as React.CSSProperties}>
            Workspace
          </p>
          <h1 className="display workspace-title rise" style={{ "--i": 1 } as React.CSSProperties}>
            Drop a secret. <em>Once.</em>
          </h1>
        </div>
        {vault.items && live > 0 && (
          <div className="workspace-stats rise" style={{ "--i": 2 } as React.CSSProperties}>
            <span className="pill">
              <Icon name="flame" />
              {live} live
            </span>
            <span className="pill pill-mint pill-dot">{unopened} unopened</span>
          </div>
        )}
      </div>

      <div className="workspace-grid">
        {result ? (
          <ShareResult secret={result} onReset={reset} />
        ) : (
          <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
            <Composer
              secret={secret}
              ttl={ttl}
              views={views}
              encrypting={encrypting}
              error={error}
              onSecret={setSecret}
              onTtl={setTtl}
              onViews={setViews}
              onSubmit={() => void createOne()}
            />
          </div>
        )}
        <div className="rise" style={{ "--i": 3 } as React.CSSProperties}>
          <Vault items={vault.items} error={vault.error} refreshing={vault.refreshing} onRefresh={() => void vault.refresh()} />
        </div>
      </div>

      <div className="rise" style={{ "--i": 4 } as React.CSSProperties}>
        <Assurances />
      </div>
    </main>
  );
}

/** El listado, con sondeo cada diez segundos mientras la pestaña se ve. */
function useVault() {
  const [items, setItems] = useState<SecretSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      setItems(await listSecrets());
      setError(false);
    } catch {
      // Se conserva la última lista buena; el siguiente sondeo lo reintenta.
      setError(true);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void refresh(true), 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 10_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(poll);
    };
  }, [refresh]);

  return { items, error, refreshing, refresh };
}
