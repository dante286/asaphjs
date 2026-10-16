# Sending email

Asaph sends mail over SMTP through one function, `sendEmail({ to, subject, text, html })`,
in `src/lib/email/`. Nothing else in the app touches nodemailer, so a test swaps the
transport at that seam and an HTTP-API provider, if one is ever wanted, changes that one
directory. Collection invites are sent through it (see
[Invites are emailed, and their links can be copied](design/sharing.md#invites-are-emailed-and-their-links-can-be-copied)).
So is [password reset](design/accounts.md#password-reset-by-email). Better Auth's verification hook is the one call site still printing
a `[dev email stub]` line.

**It's optional.** With `SMTP_HOST` or `EMAIL_FROM` unset, `emailConfigured()` is false
and `sendEmail` prints the message, links included, to the server console instead of
sending it. That's what the stubs have always done, so existing instances and local dev
need no new configuration. It matters because this image is run by people who will never
set up mail.

| Variable | |
| --- | --- |
| `SMTP_HOST` | The server. Required to send. |
| `SMTP_PORT` | Default `587`. `465` means implicit TLS; see below. |
| `SMTP_USER` / `SMTP_PASSWORD` | Both or neither. Neither means no `AUTH`, for a relay that wants none. |
| `EMAIL_FROM` | The sender, `addr@example.com` or `Asaph <addr@example.com>`. Required to send. |

**Discrete variables, not an `SMTP_URL`.** A URL was the first design. It was dropped
because SMTP passwords are whatever the provider issues, and some issue ones a URL can't
hold as-is: an Amazon SES SMTP password is base64, so it can contain `/` and `+`. Inside a
URL those need percent-encoding, and forgetting to encode one doesn't produce a config
error. It produces an authentication failure indistinguishable from a wrong password.
Separate variables leave nothing to encode, so switching providers is a change of values,
never of format. Values are trimmed, because a stray space after the `=` fails the same
way. A value that is set but can't work, such as a non-numeric port or a password with no
user, throws an error naming the variable. It doesn't fall back to the console: someone
who set mail up should hear that it's broken, not find links in a log.

**SMTP rather than a vendor SDK.** The published image runs wherever someone deploys it,
and SMTP is the one protocol every provider speaks: Resend, Brevo, Postmark, SES,
Fastmail, a home relay. An SDK would tie the image to whichever vendor we picked. That has
already paid off once. The first plan was Azure Communication Services, and Microsoft
announced the retirement of its email service (30 September 2028) while this transport
was being built. Moving to Resend changed values in `.env`, not code.

**TLS is required, and the port decides how.** Port `465` is implicit TLS. Any other port
must upgrade with STARTTLS, and a server that doesn't offer it is an error, not a
plaintext send. nodemailer's default is to use STARTTLS *if advertised*, which is exactly
what a downgrade attack exploits: strip the advertisement and the client carries on in
the clear, with invite and reset tokens in the body. The one exception is a **loopback**
host (`localhost`, `127.0.0.1`, `::1`). There Asaph sends plaintext and doesn't attempt
STARTTLS, since the traffic never leaves the machine. That's what lets Mailpit work
below, and it's right for a production relay on localhost too, whose certificate is
usually self-signed. `localhost.evil.example` is not loopback.

**Sends are awaited, and they throw.** The transport doesn't decide what a failure means.
A failed invite should keep the invite and say so; a failed reset should look like any
other reset request. Each caller decides, so there's no queue and no retry here. Timeouts
are 10s to connect, 10s for the greeting and 20s of silence, down from nodemailer's two
minutes and ten. A send runs inline with someone's click, and a server that accepts the
connection and then goes quiet shouldn't hold that click for minutes.

## Seeing mail locally with Mailpit

`docker-compose.yml` has an optional [Mailpit](https://mailpit.axllent.org/) service
behind a profile, so a plain `docker compose up` never starts it:

```bash
docker compose --profile mail up -d mailpit
```

Then set `SMTP_HOST=localhost`, `SMTP_PORT=1025` and any `EMAIL_FROM` in `.env.local`,
restart `npm run dev`, and read what was sent, rendered, at
[localhost:8025](http://localhost:8025). Both ports are published on loopback only.

This is for `npm run dev` on the host. **The containerized `app` service can't use it.**
From inside that container Mailpit is `mailpit:1025`, which isn't loopback, so STARTTLS
is required. Mailpit only offers STARTTLS when given a certificate, and the app would
then have to be told to trust it. Adding a "TLS off" switch to make that work would be a
switch a self-hoster could also leave set in production.

## Resend

Asaph's own deployment sends through [Resend](https://resend.com), over SMTP rather than
its SDK, for the reason above. Setup, per Resend's
[SMTP guide](https://resend.com/docs/send-with-smtp):

1. In the Resend dashboard, add your domain, create the SPF and DKIM records it shows,
   and wait for **Verified**. Resend suggests a subdomain (`mail.example.com`) so the
   sending reputation stays separate from your main domain.
2. Create an API key with **Sending access**, restricted to that domain. SMTP only
   sends, so a **Full access** key would only add risk if it leaked.

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_...   # the API key
EMAIL_FROM=Asaph <asaph@mail.example.com>
```

`465` is implicit TLS. `587` (STARTTLS) works just as well. If your host blocks both, as
some cloud providers do for outbound mail on new accounts, use **`2587`** (STARTTLS).
Don't use `2465`: it's implicit TLS on a port Asaph doesn't recognise as such, so Asaph
would wait for a plaintext greeting that never comes and time out after 10 seconds.

To check the setup end to end before anything depends on it, send yourself one message:

```bash
npm run email:test -- --address you@example.com
```

It goes through `sendEmail`, the same path invites and resets take. It prints the server,
TLS mode and SMTP user it used, and exits non-zero if mail isn't configured, since the
console fallback would otherwise make it "pass" without sending anything. Each run counts
against the quota below.

Three things that will otherwise look like bugs:

- **Without a verified domain, nothing reaches anyone else.** Sending from
  `onboarding@resend.dev` only delivers to your Resend account's own address, and any
  other recipient is rejected with "You can only send testing emails to your own email
  address"
  ([details](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). That's
  fine for a first test and useless for invites. `EMAIL_FROM` has to be on the domain
  from step 1.
- **The free plan allows 100 emails a day and 3,000 a month**, and the day is a UTC
  calendar day. Every account is also limited to 10 requests a second, which Resend
  applies to SMTP the same as to its API
  ([quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)). The
  101st invite of the day is a quota, not a bug.
- **The password is the API key.** Revoking or rotating the key in the dashboard breaks
  sending with an authentication error, even though nothing in Asaph changed.
