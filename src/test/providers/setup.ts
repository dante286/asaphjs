import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { installFakeCredentials } from "./credentials";
import { recordRequestsFrom, resetRecordedRequests } from "./requests";
import { server } from "./server";

/**
 * `src/lib/metadata/rate-limiter.ts` builds a real `setInterval` in its
 * constructor, and every provider constructs its limiter at module load. Open
 * Library's is capacity 1 refilling once a second while its `hydrate` makes up
 * to four requests, so one unmitigated test would spend about four seconds of
 * wall clock waiting for tokens — for no signal about anything this tier is
 * testing.
 *
 * Replacing the module with a pass-through means no timer is ever constructed.
 * It has to happen here rather than in each spec because the providers grab
 * their limiter at evaluation time, and a setup file is loaded before the test
 * module that imports them.
 *
 * The limiter's own queueing is worth testing and is — with fake timers, in the
 * unit tier, in src/lib/metadata/rate-limiter.test.ts.
 */
vi.mock("@/lib/metadata/rate-limiter", () => ({
  getLimiter: () => ({ schedule: <T>(task: () => Promise<T>) => task() }),
}));

installFakeCredentials();

beforeAll(() => {
  /**
   * The assertion this whole tier rests on. Any request no handler claims fails
   * the test, so a change that adds an outbound call — a new provider, a new
   * endpoint on an existing one, a redirect followed to a host nobody listed —
   * cannot quietly start reaching the internet from CI. Without it, the escape
   * hatch is silent and the suite still passes.
   */
  server.listen({ onUnhandledRequest: "error" });
  recordRequestsFrom(server);
});

afterEach(() => {
  server.resetHandlers();
  resetRecordedRequests();
  vi.unstubAllEnvs();
});

afterAll(() => {
  server.close();
});
