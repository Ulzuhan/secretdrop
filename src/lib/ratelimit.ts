const buckets = new Map<string, number[]>();

export function clientIp(request: Request): string {
  const values = request.headers.get("x-forwarded-for")?.split(",").map((v) => v.trim());
  return values?.at(-1) || "direct";
}

export function rateLimit(key: string, maximum: number, windowMs: number): Response | null {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= maximum) {
    const retry = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    buckets.set(key, recent);
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retry) } }
    );
  }
  recent.push(now);
  buckets.set(key, recent);

  if (buckets.size > 10_000) {
    for (const [candidate, hits] of buckets) {
      if (!hits.length || now - hits.at(-1)! > 3_600_000) buckets.delete(candidate);
    }
  }
  return null;
}
