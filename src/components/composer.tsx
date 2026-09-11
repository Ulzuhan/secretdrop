import { useId, useMemo } from "react";
import { useProgress } from "../hooks/use-progress";
import { fakeCipher, scramble } from "../lib/scramble";
import { describeHours, describeViews } from "../lib/time";
import { Icon } from "../ui/icons";
import { Segmented } from "../ui/segmented";

/**
 * El servidor admite 256 KiB de criptograma en base64: en bytes de texto claro
 * son unos 192 KB. El tope se mide en bytes UTF-8 y no en caracteres, porque
 * un emoji son cuatro.
 */
export const MAX_BYTES = 192 * 1024;

const TTL_OPTIONS = [
  { value: 1, label: "1h", title: "1 hour" },
  { value: 6, label: "6h", title: "6 hours" },
  { value: 24, label: "24h", title: "24 hours" },
  { value: 72, label: "3d", title: "3 days" },
  { value: 168, label: "7d", title: "7 days" },
];

const VIEW_OPTIONS = [1, 2, 3, 5, 10].map((v) => ({
  value: v,
  label: `${v}×`,
  title: v === 1 ? "one view" : `${v} views`,
}));

const encoder = new TextEncoder();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

export function Composer({
  secret,
  ttl,
  views,
  encrypting,
  error,
  onSecret,
  onTtl,
  onViews,
  onSubmit,
}: {
  secret: string;
  ttl: number;
  views: number;
  encrypting: boolean;
  error: string | null;
  onSecret: (value: string) => void;
  onTtl: (value: number) => void;
  onViews: (value: number) => void;
  onSubmit: () => void;
}) {
  const fieldId = useId();
  const ttlLabel = useId();
  const viewsLabel = useId();

  const bytes = useMemo(() => encoder.encode(secret).length, [secret]);
  const over = bytes > MAX_BYTES;
  const empty = secret.trim().length === 0;

  // Mientras se envía, el texto se «cifra» ante los ojos. Sólo es teatro: el
  // cifrado real ya ha ocurrido, en la misma llamada, antes de salir nada.
  const progress = useProgress(encrypting, 650);
  const preview = useMemo(() => {
    if (!encrypting) return "";
    const shown = secret.length > 1200 ? secret.slice(0, 1200) : secret;
    return scramble(shown, fakeCipher(shown), progress);
  }, [encrypting, secret, progress]);

  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <div className="composer-head">
        <h2 id="composer-title">New secret</h2>
        <span className="pill pill-mint">
          <Icon name="lock" />
          AES-256-GCM · in this tab
        </span>
      </div>

      <div>
        <label htmlFor={fieldId} className="field-label" style={{ marginBottom: "0.55rem" }}>
          <Icon name="key" size={15} />
          Your secret
        </label>
        <div className="secret-box">
          <textarea
            id={fieldId}
            value={secret}
            onChange={(e) => onSecret(e.target.value)}
            placeholder="Paste a password, a token, an API key, a private key… anything that shouldn't sit in a chat."
            rows={7}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            disabled={encrypting}
            aria-invalid={over || undefined}
            aria-describedby={`${fieldId}-hint`}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !empty && !over && !encrypting) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          {encrypting && (
            <div className="secret-scramble" aria-hidden="true">
              {preview}
            </div>
          )}
          <div className="secret-box-foot">
            <span id={`${fieldId}-hint`} className={over ? "over" : undefined}>
              {over
                ? `${formatBytes(bytes)} · over the ${formatBytes(MAX_BYTES)} limit`
                : empty
                  ? "⌘↵ to create"
                  : `${secret.length.toLocaleString()} chars · ${formatBytes(bytes)}`}
            </span>
            {!empty && !encrypting && (
              <button type="button" className="link-btn" onClick={() => onSecret("")}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="composer-options">
        <div className="option">
          <span id={ttlLabel} className="field-label">
            <Icon name="clock" size={15} />
            Self-destructs after
          </span>
          <Segmented labelledBy={ttlLabel} value={ttl} options={TTL_OPTIONS} onChange={onTtl} />
        </div>
        <div className="option">
          <span id={viewsLabel} className="field-label">
            <Icon name="eye" size={15} />
            Can be opened
          </span>
          <Segmented labelledBy={viewsLabel} value={views} options={VIEW_OPTIONS} onChange={onViews} />
        </div>
      </div>

      <p className="composer-summary" aria-live="polite">
        <Icon name="flame" size={17} />
        <span>
          Burns after <strong>{describeViews(views)}</strong> or in <strong>{describeHours(ttl)}</strong>, whichever
          comes first.
        </span>
      </p>

      {error && (
        <div role="alert" className="notice notice-danger">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-lg btn-block composer-submit"
        onClick={onSubmit}
        disabled={empty || over || encrypting}
      >
        {encrypting ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Encrypting…
          </>
        ) : (
          <>
            <Icon name="lock" size={18} />
            Create encrypted link
          </>
        )}
      </button>

      <p className="composer-note">
        <Icon name="shield" size={14} />
        Encrypted here before anything is sent. The server only ever stores ciphertext.
      </p>
    </section>
  );
}
