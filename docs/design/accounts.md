# Accounts and sign-in

Asaph authenticates with email and password through Better Auth, with sessions stored in
the same Postgres as everything else. There is no external identity provider. This page is
the reasoning behind the account lifecycle: who may register, how a forgotten password is
recovered, and what deleting an account takes with it. For the operator's checklist, see
[Self-hosting](../self-hosting.md#closing-registration).

## Closing registration on an instance

`ALLOW_SIGNUPS=false` closes registration: the "Create account" segment disappears from
`/auth` and the sign-up API answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`. It's the switch
for running Asaph for one person or a household on a URL anyone can reach. Set it in
`.env.local` for local dev, or the top-level `.env` for Compose, and restart the server —
`betterAuth()` reads the flag once at startup.

Only the literal `false` closes signups. Unset, empty, or a typo (`fasle`, `no`, `0`) leaves
them open. That's deliberate: failing *closed* on a typo would be safer for a private
instance, but the failure it creates is worse — an operator with no account and no UI to fix
it, needing an env edit and a redeploy to get back in. Open-on-garbage is the recoverable
mistake.

One check covers every entry point. The Server Actions call `auth.api.signUpEmail` rather than
reimplementing the insert, and the gate is `databaseHooks.user.create.before` in
`src/lib/auth/auth.ts`, which every user creation passes through — so the Server Action and
`/api/auth/sign-up/email` are rejected on the same check, with no second guard to drift apart.
With signups closed it lets through only a sign-up carrying a pending registration invite's
token for that exact address. The same check also runs earlier, as a `hooks.before` on
`/sign-up/email`: Better Auth looks the address up before it creates anyone, and without that
early refusal a closed sign-up would answer "user already exists" for an address with an
account, telling anyone who asks who has one here. Hiding the tab in `AuthForm` is
about honesty, not enforcement: a closed door shouldn't be something you discover by filling
in a form and submitting it.

**Create your account before you close registration.** A fresh deployment with
`ALLOW_SIGNUPS=false` and an empty `user` table has no way in at all — no first-run bootstrap,
no admin CLI. Sign up first, confirm you can sign in, *then* flip the flag and restart. If you
seeded with `npm run db:seed -- --demo`, the `demo@example.com` account described under
[Demo data](../local-development.md#demo-data)
already exists and is a usable way in, so a demo instance can be closed straight away — change
its password first, since the seed's is published in these docs.

**Invites only work for people who already have an account.** An invite token doesn't
authorize a registration. `/invite/:token` sends a signed-out visitor to
`/auth?next=/invite/:token`, and with signups closed the only thing there is a sign-in form —
so an invited person with no account cannot accept, and the invite is dead. The invite page
says as much when the flag is set rather than sending them to `/auth` to find the tab missing.
Sharing on a closed instance means everyone you share with has an account you made while
registration was open.

## Password reset by email

"Forgot password?" on `/auth` asks for an address and mails a link to `/auth/reset`, where
the person picks a new password. Both steps are Server Actions calling Better Auth's
`requestPasswordReset` and `resetPassword`, the same way `signUpAction` calls
`signUpEmail`, so nothing about tokens is reimplemented. The token lasts an hour and works
once. Setting a new password signs out **every** session the account had
(`revokeSessionsOnPasswordReset`), since a reset is often the answer to someone else being
signed in. The person then signs in with the new password, on this device too.

**Only offered when it can work: mail configured *and* `BETTER_AUTH_URL` set.** Without
both, `sendResetPassword` isn't passed to `betterAuth()`, so Better Auth's endpoint answers
`RESET_PASSWORD_DISABLED`, and `/auth` shows no link. That's the `ALLOW_SIGNUPS` rule again:
a feature that can't work shouldn't be something you find out about by filling in a form.
On such an instance the way back into a locked account is the operator, as it always was.
Like the registration gate, it's decided once at startup.

**Why `BETTER_AUTH_URL`, when share and invite links use the request's own origin.**
`requestOrigin()` reads `Host` and `X-Forwarded-Host`, and whoever sends a request chooses
those. Suppose someone asks for a reset of *your* address with a forged host. A link built
from the request would put your live token on their domain, and one click hands them your
account. Invite links don't have this problem, because an invite token only works when
accepted by the account it names. A reset token *is* the account. So the origin has to come
from the operator, and `BETTER_AUTH_URL` is the variable they already set. Better Auth hands
`sendResetPassword` a ready-made `url` as well. That's ignored: it points at Better Auth's
own `/api/auth/reset-password/:token` redirect hop, and the page that takes the password is
ours. The Compose file sets `BETTER_AUTH_URL=http://localhost:3000`. Change it to your public
origin, or reset emails will send people to localhost.

**The same answer for every address.** "If that address has an account, a link is on its
way" whether it has one or not, whether the email was held back, and whether the send
failed. Anything else would make the form a way to find out who has an account. Better Auth
already answers an unknown address with its success message and simulates the lookup to
blunt timing differences. The action doesn't undo that on the way out. A failed send is
logged for the operator and never shown.

**One email a minute per address, on both entry points.** Better Auth rate-limits
`/request-password-reset` to 3 a minute, but that limiter only runs for HTTP requests to
`/api/auth/*`. A Server Action calls `auth.api.*` directly and never meets it. Without a
check of our own, anyone could make the instance send an unlimited stream of reset emails
to any address, spending the operator's send quota (Resend's free plan is 100 a day) and
flooding the inbox. The check is in `sendResetPassword` (`shouldSendReset` in
`src/db/queries/password-reset.ts`) rather than in the action, because that callback is the
one place both the action and the HTTP route pass through. By then Better Auth has written
the new token's row. If an earlier `reset-password:` row for the same user exists from the
last 60 seconds, nothing is sent and the new row is deleted, so the only live links are ones
somebody was actually sent. "Earlier" is by `createdAt`, then id. That way two overlapping
requests agree on which one sends. Counting *any* other row would have each hold the other
back, and a double-clicked button would send nothing. Deleting held-back rows keeps the
window anchored to the last email that went out, so a loop of requests gets one email a
minute through rather than locking the real owner out for as long as it runs.

Not here: changing an email address, email verification, an admin-initiated reset, and a
general IP-based limiter for Server Actions. A reset signs out every session, but a device's
five-minute session cookie cache (`session.cookieCache`) can still read as signed in until
it lapses. The same is true of "Sign out everywhere".

## Deleting an account sweeps its uploads first

The Security section of `/account` has a Delete account action. It asks for the password —
not for a typed-out confirmation phrase — because `auth.api.deleteUser` asks for one itself:
without a password it insists the session be fresher than `freshAge` (a day), so someone
signed in since last week would get `SESSION_EXPIRED` from a button that looked ready.
Asking every time makes the gate the same gate every time, and a live session on a borrowed
laptop can't get through it. The confirmation links to the CSV and JSON exports, which is
the whole of the export-before-delete story here.

Deletion is the cascade the uploads store can least afford. `collections.owner_id` is
`on delete cascade` and items cascade from collections, so removing one `user` row takes
every collection and item with it in a single statement the app never sees row by row —
and every re-encoded WebP and `_t` thumbnail those items named would sit in `UPLOADS_DIR`
with nothing left that could ever reach them. So the sweep hangs off Better Auth's
`user.deleteUser.beforeDelete` hook (`src/lib/auth/auth.ts`), which runs *before*
`internalAdapter.deleteUser`: the rows are still there, their cover URLs are still
readable, and the ordering is the same read-before-delete one `deleteCollection` uses one
level down. `afterDelete` was the wrong hook for exactly the reason it looks like the right
one — it fires when the deletion is safely done, which is also when the record of what to
delete is gone.

The gathering lives in `deleteUploadsForOwner()` in `src/db/queries/collections.ts`, beside
the other sweeps rather than inline in the auth config, so the next caller can't forget it.
It joins items to collections and filters on `owner_id`, and that join is the point: an
editor on somebody else's collection can upload a photo to an item there, and that item
outlives them — unlinking its file would blank a cover in a collection whose owner never
asked for anything. Nothing in the hook catches, either. A covers list we can't read is a
sweep we can't perform, and refusing the deletion beats stranding someone's photos on disk
forever; the unlinks themselves stay best-effort, so an already-missing file doesn't stop
anyone leaving.

**`collection_members.invited_by` needed an `on delete` action for any of this to work**
(migration `0005`). It had none, so it defaulted to `no action` — and account deletion then
failed outright for any owner who had ever sent an invite. Deleting the `user` does cascade
to `collections` and on to these rows, but Postgres fires both referential triggers as
after-row triggers on the same statement in constraint-name order, and
`collection_members_invited_by_…` sorts ahead of `collections_owner_id_…`: the check ran
against rows that hadn't been cascaded away yet and raised `23503`. It's now `set null`
rather than `cascade`, because cascade would be a promise the column can't keep — it would
take the membership along with the inviter, and who invited whom is provenance while the
membership is the fact. Worth knowing if you hit a similar constraint: Better Auth's delete
isn't wrapped in a transaction, so the failed attempt still removed the `account` row before
the `user` delete blew up, leaving a user who could no longer sign in.
