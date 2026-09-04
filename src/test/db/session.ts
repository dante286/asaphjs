import type { TestUser } from "./fixtures";

/**
 * Who `next/headers` reports as signed in.
 *
 * Route handlers need none of this — `requireRole` reads `request.headers`, so
 * a hand-built Request carries its own session. Server Actions and the lookup
 * route do: they reach for `next/headers`, which only exists inside a request
 * scope. So those specs mock that one module and let it read this, which keeps
 * the *real* Better Auth session validation in the path — a forged or absent
 * cookie reads as signed out because the library says so, not because a stub
 * said so.
 *
 * The mock itself has to be declared per spec file (`vi.mock` is hoisted into
 * the file that calls it), and looks like:
 *
 *     vi.mock("next/headers", async () => {
 *       const { sessionHeaders } = await import("@/test/db/session");
 *       return { headers: async () => sessionHeaders() };
 *     });
 */
const state = { cookie: "" };

export function signedInAs(user: Pick<TestUser, "cookie">): void {
  state.cookie = user.cookie;
}

export function signedOut(): void {
  state.cookie = "";
}

/** A forged cookie, to check that "signed in" is decided by Better Auth rather than by presence. */
export function signedInWith(cookie: string): void {
  state.cookie = cookie;
}

export function sessionHeaders(): Headers {
  return new Headers(state.cookie ? { cookie: state.cookie } : {});
}
