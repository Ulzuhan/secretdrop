import { useNow } from "../hooks/use-now";
import type { SecretSummary } from "../lib/api";
import { elapsedFraction, formatRemaining, timeAgo } from "../lib/time";
import { Icon } from "../ui/icons";

/**
 * Los secretos que siguen vivos. Sólo metadatos: aquí no se puede leer
 * ninguno, ni siquiera quien los creó, porque la clave nunca llegó.
 */
export function Vault({
  items,
  error,
  refreshing,
  onRefresh,
}: {
  items: SecretSummary[] | null;
  error: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  useNow(20_000);
  const now = Date.now();

  return (
    <aside className="panel vault" aria-labelledby="vault-title">
      <div className="vault-head">
        <h2 id="vault-title">Active secrets</h2>
        {items && items.length > 0 && <span className="vault-count">{items.length}</span>}
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onRefresh}
          aria-label="Refresh the list"
          title="Refresh"
          disabled={refreshing}
        >
          <Icon name="refresh" size={16} className={refreshing ? "spin" : undefined} />
        </button>
      </div>

      {error && (
        <div role="status" className="notice">
          <Icon name="alert" />
          <span>Couldn&apos;t reach the server just now. Showing the last list it sent.</span>
        </div>
      )}

      {items === null ? (
        <div className="vault-list" aria-busy="true" aria-label="Loading">
          <div className="skeleton" style={{ height: "4.6rem" }} />
          <div className="skeleton" style={{ height: "4.6rem", opacity: 0.7 }} />
          <div className="skeleton" style={{ height: "4.6rem", opacity: 0.4 }} />
        </div>
      ) : items.length === 0 ? (
        <div className="vault-empty">
          <span className="glyph" aria-hidden="true">
            <Icon name="inbox" size={22} />
          </span>
          <strong>Nothing live right now.</strong>
          <p>Secrets you create show up here until they burn or expire.</p>
        </div>
      ) : (
        <ul className="vault-list">
          {items.map((s) => {
            const left = s.maxViews - s.viewCount;
            const opened = s.viewCount > 0;
            return (
              <li key={s.id} className="vault-item">
                <div className="vault-item-row">
                  <code className="vault-id" title={s.id}>
                    <span>/v/</span>
                    {s.id}
                  </code>
                  <span className={`pill pill-dot ${opened ? "pill-ember" : "pill-mint"}`}>
                    {opened ? (left === 1 ? "last view left" : `${left} views left`) : "unopened"}
                  </span>
                </div>
                <div className="vault-meta">
                  <span>
                    created <strong>{timeAgo(s.createdAt, now)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    burns in <strong>{formatRemaining(s.expiresAt, now)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    <strong>
                      {s.viewCount}/{s.maxViews}
                    </strong>{" "}
                    opened
                  </span>
                </div>
                <div className="vault-bar" aria-hidden="true">
                  <i style={{ "--p": elapsedFraction(s.createdAt, s.expiresAt, now) } as React.CSSProperties} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="vault-note">
        <Icon name="eyeOff" size={14} />
        <span>Only metadata is listed. The contents can&apos;t be read from here, not even by you.</span>
      </p>
    </aside>
  );
}
