/**
 * `ALLOW_SIGNUPS=false` closes registration on an instance — one person or a
 * household running Asaph for themselves, with `/auth` reachable by anyone who
 * has the URL.
 *
 * Only the literal string `false` closes signups. Unset, empty, or a typo
 * (`fasle`, `no`, `0`) leaves them open. The safer-looking alternative — treat
 * anything that isn't `true` as closed — fails the wrong way: a typo on a
 * private instance is a door left open, but a typo on the other design locks
 * out an operator who has no account yet and no UI to fix it. Open-on-garbage
 * is recoverable; locked-out-on-garbage means editing env and redeploying to
 * get back in.
 *
 * Read at request time by the sign-in page, and once at module load by
 * `betterAuth()` in `./auth` — so changing this needs a server restart, not
 * just a reload.
 */
export function signupsAllowed(): boolean {
  return process.env.ALLOW_SIGNUPS?.trim().toLowerCase() !== "false";
}
