import { useId } from "react";
import { useCopy } from "../hooks/use-copy";
import { useNow } from "../hooks/use-now";
import { formatRemaining } from "../lib/time";
import { Icon } from "../ui/icons";

export interface ShareableSecret {
  id: string;
  url: string;
  expiresAt: number;
  maxViews: number;
}

/**
 * El enlace, y una sola manera de cogerlo que no falle: un campo con el texto
 * entero, siempre visible. Copiar es un atajo; si el portapapeles dice que no,
 * la persona sigue teniendo su secreto delante.
 */
export function ShareResult({ secret, onReset }: { secret: ShareableSecret; onReset: () => void }) {
  useNow(15_000);
  const now = Date.now();
  const { state, copy } = useCopy();
  const fieldId = useId();
  const key = secret.url.split("#")[1] ?? "";

  return (
    <section className="panel result" aria-labelledby="result-title">
      <div className="result-head">
        <span className="glyph glyph-mint" aria-hidden="true">
          <Icon name="check" size={26} strokeWidth={2.2} />
        </span>
        <div>
          <h2 id="result-title" className="display">
            Encrypted and ready to share.
          </h2>
          <p>
            Only someone holding this exact link can read it. The key is the part after <code>#</code>, and it
            never reached the server.
          </p>
        </div>
      </div>

      <div className="share-box">
        <label htmlFor={fieldId} className="field-label">
          <Icon name="link" size={15} />
          Secret link
        </label>
        <div className="share-field">
          <input
            id={fieldId}
            readOnly
            value={secret.url}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn btn-primary" onClick={() => copy(secret.url)}>
            {state === "copied" ? (
              <>
                <Icon name="check" size={17} strokeWidth={2.2} />
                Copied
              </>
            ) : (
              <>
                <Icon name="copy" size={17} />
                Copy link
              </>
            )}
          </button>
        </div>
        <div className="share-anatomy">
          <span>
            <code>/v/{secret.id}</code> the address
          </span>
          <span>
            <code className="key">#{key.slice(0, 6)}…</code> the key, which only lives in this link
          </span>
        </div>
      </div>

      {state === "failed" && (
        <div role="status" className="notice notice-ember">
          <Icon name="alert" />
          <span>
            The browser refused clipboard access. Select the link above and copy it by hand; it is the
            complete link.
          </span>
        </div>
      )}

      <ul className="meta-list">
        <li>
          <Icon name="eye" size={15} />
          Opens <strong>{secret.maxViews === 1 ? "once" : `${secret.maxViews} times`}</strong>
        </li>
        <li>
          <Icon name="clock" size={15} />
          Expires in <strong>{formatRemaining(secret.expiresAt, now)}</strong>
        </li>
        <li>
          <Icon name="flame" size={15} />
          Then it burns
        </li>
      </ul>

      <div className="result-actions">
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          <Icon name="sparkle" size={16} />
          New secret
        </button>
        <span className="muted" style={{ fontSize: "0.8125rem" }}>
          Treat the whole link as the secret. Don&apos;t paste it into logs or tickets.
        </span>
      </div>
    </section>
  );
}
