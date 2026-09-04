import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * MSW intercepts at the network layer, below `fetch`, which is what makes this
 * worth the setup over stubbing `globalThis.fetch`: the provider code runs
 * completely unmodified — its own URL construction, headers, status handling
 * and JSON parsing all execute, and the specs get to assert on the request that
 * came out the far end.
 *
 * Its lifecycle is wired in ./setup.ts. Specs import this to prepend a handler
 * for one test with `server.use(...)`; the setup file resets those afterwards.
 */
export const server = setupServer(...handlers);
