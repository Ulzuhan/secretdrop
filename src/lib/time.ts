/** Formatos de tiempo para humanos. Puros, para poder probarlos sin DOM. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Cuánto queda hasta `until`: «3d 2h», «5h 12m», «8m», «under a minute», «expired». */
export function formatRemaining(until: number, now = Date.now()): string {
  const diff = until - now;
  if (diff <= 0) return "expired";
  if (diff < MIN) return "under a minute";
  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const mins = Math.floor((diff % HOUR) / MIN);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Cuánto hace de `then`: «just now», «4m ago», «3h ago», «2d ago». */
export function timeAgo(then: number, now = Date.now()): string {
  const diff = Math.max(0, now - then);
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/** Fracción [0, 1] del plazo consumida entre `from` y `until`. */
export function elapsedFraction(from: number, until: number, now = Date.now()): number {
  const total = until - from;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - from) / total));
}

/** «1 hour», «6 hours», «3 days», «7 days». */
export function describeHours(hours: number): string {
  if (hours % 24 === 0 && hours >= 24) {
    const days = hours / 24;
    return days === 1 ? "1 day" : `${days} days`;
  }
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** «one view», «3 views». */
export function describeViews(views: number): string {
  return views === 1 ? "the first view" : `${views} views`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
