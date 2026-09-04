import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLimiter } from "./rate-limiter";

/**
 * Every provider builds its limiter at module load, and the providers tier
 * replaces this module with a pass-through so that no test spends real seconds
 * waiting for tokens. That leaves the queueing itself untested unless it's
 * tested here — on fake timers, where a one-second window costs nothing.
 *
 * `getLimiter` memoises into a module-level Map, so a key used twice in this
 * file would hand the second test a limiter with the first test's tokens
 * already spent. Every test takes its own.
 */
let keys = 0;
const nextKey = () => `test-limiter-${++keys}`;

/** Resolves after the microtasks a settled `schedule` has queued behind it. */
const flush = () => Promise.resolve();

describe("the token window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts full, so the first burst goes out without waiting", async () => {
    const limiter = getLimiter(nextKey(), 3, 1000);
    const task = vi.fn(async () => "done");

    const results = await Promise.all([limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)]);

    // No timer advanced: an interactive lookup shouldn't pay a window's latency
    // to make its first request.
    expect(results).toEqual(["done", "done", "done"]);
  });

  it("holds everything past the capacity until the window refills", async () => {
    const limiter = getLimiter(nextKey(), 1, 1000);
    const task = vi.fn(async () => "done");

    limiter.schedule(task);
    const queued = limiter.schedule(task);
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);

    await expect(queued).resolves.toBe("done");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("releases no more than the capacity per window", async () => {
    const limiter = getLimiter(nextKey(), 2, 1000);
    const task = vi.fn(async () => "done");

    const all = Promise.all(Array.from({ length: 5 }, () => limiter.schedule(task)));
    await flush();
    expect(task).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    await flush();
    expect(task).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(1000);
    await expect(all).resolves.toHaveLength(5);
    expect(task).toHaveBeenCalledTimes(5);
  });

  it("runs what it queued in the order it was scheduled", async () => {
    const limiter = getLimiter(nextKey(), 1, 1000);
    const started: number[] = [];
    const schedule = (n: number) => limiter.schedule(async () => void started.push(n));

    schedule(1);
    const rest = Promise.all([schedule(2), schedule(3)]);

    vi.advanceTimersByTime(2000);
    await rest;

    // FIFO — a lookup that queued behind a backfill job shouldn't be starved by
    // one that arrived after it.
    expect(started).toEqual([1, 2, 3]);
  });

  it("hands a rejection back to its own caller", async () => {
    const limiter = getLimiter(nextKey(), 2, 1000);

    await expect(limiter.schedule(async () => Promise.reject(new Error("IGDB games failed: 500")))).rejects.toThrow(
      "IGDB games failed: 500",
    );
  });

  it("keeps draining the queue after a task rejects", async () => {
    // A provider erroring under load must not wedge every request behind it —
    // the limiter is shared by every caller in the process.
    const limiter = getLimiter(nextKey(), 1, 1000);
    const failing = limiter.schedule(async () => Promise.reject(new Error("boom")));
    const after = limiter.schedule(async () => "done");

    await expect(failing).rejects.toThrow("boom");
    vi.advanceTimersByTime(1000);

    await expect(after).resolves.toBe("done");
  });

  it("gives every key its own tokens", async () => {
    const igdb = getLimiter(nextKey(), 1, 1000);
    const openlibrary = getLimiter(nextKey(), 1, 1000);
    const task = vi.fn(async () => "done");

    await Promise.all([igdb.schedule(task), openlibrary.schedule(task)]);

    // One limiter per provider, or a slow provider would spend another's budget.
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("reuses the limiter for a key it already has, and ignores the new capacity", async () => {
    // The memoisation is the point — every caller in the process has to share
    // one budget per provider. The footgun is that the capacity of a second
    // call is silently discarded, so the first caller's numbers are the ones
    // that count.
    const key = nextKey();
    const first = getLimiter(key, 1, 1000);
    const second = getLimiter(key, 50, 1000);
    const task = vi.fn(async () => "done");

    expect(second).toBe(first);

    second.schedule(task);
    second.schedule(task);
    await flush();

    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe("the refill timer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is unref'd, so it can't hold a short-lived process open", () => {
    // scripts/check-lookup-cache.ts imports a provider, which builds a limiter.
    // A referenced interval would keep that script's event loop alive with
    // nothing left to do.
    const unref = vi.fn();
    vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as NodeJS.Timeout);

    getLimiter(nextKey(), 1, 1000);

    expect(unref).toHaveBeenCalledOnce();
  });
});
