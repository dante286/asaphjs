import { LimiterBusyError } from "./limiter-busy";

// A sliding window: at most `capacity` requests start in any `windowMs`-long
// span. A fixed window that refills all at once lets a full burst at the end of
// one window and another at the start of the next land within a few
// milliseconds — twice the provider's ceiling, which IGDB answers with a 429.
// Here each slot frees exactly `windowMs` after the request that took it
// started. One instance per provider, shared by every caller (interactive
// lookup + any future backfill job) so neither starves the other or exceeds
// the provider's ceiling. In-memory is fine for a single-instance app; move to
// Postgres/Redis only if that ever changes.
//
// The queue is bounded. Every caller shares it, so without a bound one person
// hammering search could hold everyone else's lookups behind theirs and grow it
// without limit. Past the bound a request is refused at once (LimiterBusyError)
// rather than waiting minutes for a slot.
class SlidingWindowLimiter {
  private queue: Array<() => void> = [];
  /** When each request in the current window started, oldest first. */
  private starts: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly key: string,
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly maxQueue: number,
  ) {}

  private prune(now: number) {
    while (this.starts.length > 0 && now - this.starts[0] >= this.windowMs) this.starts.shift();
  }

  private drain() {
    const now = Date.now();
    this.prune(now);
    while (this.starts.length < this.capacity && this.queue.length > 0) {
      this.starts.push(now);
      this.queue.shift()!();
    }
    if (this.queue.length > 0 && this.timer === null) {
      // Wake when the oldest slot frees. unref so the timer doesn't hold the
      // event loop open — matters for short-lived processes that import a
      // provider (scripts/check-lookup-cache.ts), not the long-running server.
      const timer: ReturnType<typeof setTimeout> & { unref?: () => void } = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, this.starts[0] + this.windowMs - now);
      timer.unref?.();
      this.timer = timer;
    }
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => task().then(resolve, reject);
      if (this.queue.length >= this.maxQueue) {
        reject(new LimiterBusyError(this.key));
        return;
      }
      this.queue.push(run);
      this.drain();
    });
  }
}

const limiters = new Map<string, SlidingWindowLimiter>();

/** Requests that may wait for a slot, per provider. At Open Library's one a second, a minute's worth. */
export const DEFAULT_MAX_QUEUE = 60;

export function getLimiter(
  key: string,
  capacity: number,
  windowMs: number,
  maxQueue = DEFAULT_MAX_QUEUE,
): SlidingWindowLimiter {
  if (!limiters.has(key)) limiters.set(key, new SlidingWindowLimiter(key, capacity, windowMs, maxQueue));
  return limiters.get(key)!;
}
