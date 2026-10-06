export function createRateLimiter(o: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - o.windowMs);
      if (recent.length >= o.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
