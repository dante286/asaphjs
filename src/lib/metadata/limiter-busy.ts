/**
 * Thrown by a provider limiter whose queue is full. In a module of its own
 * because several test files replace `./rate-limiter` with a pass-through, and
 * the route that tells this apart from a provider failure has to import it.
 */
export class LimiterBusyError extends Error {
  constructor(key: string) {
    super(`The ${key} lookup queue is full.`);
    this.name = "LimiterBusyError";
  }
}
