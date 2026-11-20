/**
 * How long a metadata provider gets to answer before the request is abandoned.
 * Without one, a provider that hangs holds the lookup for undici's default
 * (about five minutes), and every identical lookup that `cached-provider`
 * coalesces onto it waits just as long.
 */
export const PROVIDER_TIMEOUT_MS = 10_000;

export function providerTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
}
