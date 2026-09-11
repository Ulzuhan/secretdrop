import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCopy } from "../hooks/use-copy";
import { useNow } from "../hooks/use-now";
import { fetchSecret, type SecretPayload } from "../lib/api";
import { decryptSecret } from "../lib/crypto";
import { routeParams } from "../lib/navigation";
import { formatRemaining } from "../lib/time";
import { Embers } from "../ui/embers";
import { Icon, type IconName } from "../ui/icons";

type State =
  | { kind: "loading" }
  | { kind: "decrypted"; data: SecretPayload; plaintext: string }
  | { kind: "burned" }
  | { kind: "expired" }
  | { kind: "missing" }
  | { kind: "nokey" }
  | { kind: "corrupt" }
  | { kind: "error"; message: string };

/**
 * Quien recibe el enlace. Pedir el criptograma consume una vista, así que
 * sólo se pide con la clave en mano: abrir un enlace incompleto no gasta nada.
 */
export function Viewer() {
  const { id } = routeParams();
  const [state, setState] = useState<State>({ kind: "loading" });

  const run = useCallback(
    async (key: string) => {
      if (!id) {
        setState({ kind: "missing" });
        return;
      }
      let fetched;
      try {
        fetched = await fetchSecret(id);
      } catch {
        setState({ kind: "error", message: "The network request failed before anything was consumed. Check your connection and try again." });
        return;
      }
      if (fetched.kind !== "ok") {
        setState(fetched.kind === "error" ? { kind: "error", message: fetched.message } : { kind: fetched.kind });
        return;
      }
      try {
        const plaintext = await decryptSecret(fetched.data.ciphertext, fetched.data.iv, key);
        setState({ kind: "decrypted", data: fetched.data, plaintext });
      } catch {
        setState({ kind: "corrupt" });
      }
    },
    [id],
  );

  useEffect(() => {
    // Desde una macrotarea: la clave se lee del fragmento, que sólo existe en
    // el navegador, y la primera pintura no espera a la petición.
    const kickoff = setTimeout(() => {
      const key = window.location.hash.slice(1);
      if (!key) setState({ kind: "nokey" });
      else void run(key);
    }, 0);
    return () => clearTimeout(kickoff);
  }, [run]);

  return (
    <main className="container-narrow viewer">
      <Screen state={state} />
    </main>
  );
}

function Screen({ state }: { state: State }) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="panel viewer-loading">
          <span className="lock" aria-hidden="true">
            <Icon name="lock" size={26} />
          </span>
          <p>Retrieving the encrypted secret…</p>
          <small>decrypting in your browser</small>
        </div>
      );
    case "decrypted":
      return <Decrypted data={state.data} plaintext={state.plaintext} />;
    case "burned":
      return (
        <Ending tone="ember" icon="flame" title="This secret has burned." embers>
          <p>
            It was already opened as many times as its sender allowed, so the server deleted it. There is
            nothing left to show, and the link can&apos;t be revived.
          </p>
          <p>If you expected to read it, ask the sender for a new one.</p>
        </Ending>
      );
    case "expired":
      return (
        <Ending tone="neutral" icon="hourglass" title="This secret has expired.">
          <p>Its time ran out before anyone opened it. Nothing remains on the server.</p>
          <p>Ask the sender for a fresh link.</p>
        </Ending>
      );
    case "missing":
      return (
        <Ending tone="neutral" icon="ghost" title="This secret has expired or never existed.">
          <p>There is nothing on the server under this address. Expired secrets are removed, and the link may be mistyped.</p>
        </Ending>
      );
    case "nokey":
      return (
        <Ending tone="ember" icon="key" title="This link is missing its key.">
          <p>
            Everything after the <code>#</code> in the address is the decryption key, and it isn&apos;t
            there. Links usually lose it when they are pasted through something that strips fragments.
          </p>
          <p>
            A complete link looks like{" "}
            <code>
              /v/8fK2wQzLp1xY<span className="key">#Lm9vR3pQ…</span>
            </code>
            . Ask the sender to copy it whole. Nothing was consumed: the secret is still waiting.
          </p>
        </Ending>
      );
    case "corrupt":
      return (
        <Ending tone="danger" icon="alert" title="Something went wrong.">
          <p>
            The key in this link does not decrypt what the server returned. The link may have been altered
            somewhere along the way.
          </p>
          <p>This attempt did count as a view. Ask the sender for a new link.</p>
        </Ending>
      );
    case "error":
      return (
        <Ending tone="danger" icon="alert" title="Something went wrong.">
          <p>{state.message}</p>
          <div className="ending-actions">
            <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={16} />
              Try again
            </button>
          </div>
        </Ending>
      );
  }
}

function Decrypted({ data, plaintext }: { data: SecretPayload; plaintext: string }) {
  useNow(15_000);
  const now = Date.now();
  const { state: copyState, copy } = useCopy();
  const [masked, setMasked] = useState(false);
  const isLast = data.viewCount >= data.maxViews;
  const left = data.maxViews - data.viewCount;

  return (
    <div className="panel reveal">
      {isLast && <Embers />}
      <div className="reveal-head">
        <span className="pill pill-mint">
          <Icon name="unlock" />
          Decrypted in your browser
        </span>
        <span className={`pill ${isLast ? "pill-ember" : ""}`}>
          {isLast ? (
            <>
              <Icon name="flame" />
              view {data.viewCount} of {data.maxViews} · burned
            </>
          ) : (
            <>
              <Icon name="eye" />
              view {data.viewCount} of {data.maxViews}
            </>
          )}
        </span>
      </div>

      <h1 className="display reveal-title">Someone sent you a secret.</h1>
      <p className="reveal-sub">
        It was decrypted right here, in this tab. The server only ever held ciphertext.
      </p>

      <div className="secret-out" data-masked={masked}>
        <pre>{plaintext}</pre>
        <div className="secret-out-tools">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => setMasked((m) => !m)}
            aria-pressed={masked}
            aria-label={masked ? "Show the secret" : "Hide the secret"}
            title={masked ? "Show" : "Hide"}
          >
            <Icon name={masked ? "eye" : "eyeOff"} size={16} />
          </button>
        </div>
      </div>

      <div className="reveal-actions">
        <button type="button" className="btn btn-primary" onClick={() => copy(plaintext)}>
          {copyState === "copied" ? (
            <>
              <Icon name="check" size={17} strokeWidth={2.2} />
              Copied
            </>
          ) : (
            <>
              <Icon name="copy" size={17} />
              Copy secret
            </>
          )}
        </button>
        {copyState === "failed" && (
          <span className="muted" style={{ fontSize: "0.8125rem" }}>
            Clipboard access was refused. Select the text above to copy it.
          </span>
        )}
      </div>

      {isLast ? (
        <div className="notice notice-ember" role="status">
          <Icon name="flame" />
          <span>
            That was the last allowed view. The secret has been deleted from the server: copy it now if you
            need it, because it cannot be opened again.
          </span>
        </div>
      ) : (
        <ul className="meta-list">
          <li>
            <Icon name="eye" size={15} />
            <strong>{left}</strong> {left === 1 ? "view" : "views"} remaining
          </li>
          <li>
            <Icon name="clock" size={15} />
            Expires in <strong>{formatRemaining(data.expiresAt, now)}</strong>
          </li>
        </ul>
      )}

      <div className="reveal-foot">
        <a href="/" className="link-quiet">
          Send your own secret
          <Icon name="arrow" size={15} />
        </a>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Close this tab when you are done.
        </span>
      </div>
    </div>
  );
}

function Ending({
  tone,
  icon,
  title,
  embers,
  children,
}: {
  tone: "ember" | "neutral" | "danger";
  icon: IconName;
  title: string;
  embers?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="panel ending">
      {embers && <Embers />}
      <span className={`glyph ${tone === "ember" ? "glyph-ember" : tone === "danger" ? "glyph-danger" : ""}`} aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <h1 className="display">{title}</h1>
      {children}
      <div className="ending-actions">
        <a href="/" className="btn btn-secondary">
          <Icon name="home" size={16} />
          Go to SecretDrop
        </a>
      </div>
    </div>
  );
}
