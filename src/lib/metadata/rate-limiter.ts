// Fixed-window, not a true leaky bucket — simpler, and the difference doesn't
// matter at this request volume. One instance per provider, shared by every
// caller (interactive lookup + any future backfill job) so neither starves
// the other or exceeds the provider's ceiling. In-memory is fine for a
// single-instance app; move to Postgres/Redis only if that ever changes.
class FixedWindowLimiter {
  private queue: Array<() => void> = [];
  private tokens: number;

  constructor(private readonly capacity: number, refillMs: number) {
    this.tokens = capacity;
    // unref so the timer doesn't hold the event loop open — matters for
    // short-lived processes that import a provider (scripts/check-lookup-cache.ts),
    // not for the long-running server.
    const timer: ReturnType<typeof setInterval> & { unref?: () => void } = setInterval(
      () => this.refill(),
      refillMs,
    );
    timer.unref?.();
  }

  private refill() {
    this.tokens = this.capacity;
    while (this.tokens > 0 && this.queue.length > 0) {
      this.tokens--;
      this.queue.shift()!();
    }
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => task().then(resolve, reject);
      if (this.tokens > 0) {
        this.tokens--;
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}

const limiters = new Map<string, FixedWindowLimiter>();

export function getLimiter(key: string, capacity: number, refillMs: number): FixedWindowLimiter {
  if (!limiters.has(key)) limiters.set(key, new FixedWindowLimiter(capacity, refillMs));
  return limiters.get(key)!;
}
