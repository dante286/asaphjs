# Sharing

A collection can be shared two independent ways: per-person invites with a viewer or editor
role, and a public read-only link. How to use both is in the
[user guide](../user-guide.md#sharing-a-collection); this page is why they behave the way
they do.

## Turning a public link off keeps its address

Unticking "Public link" writes `share_enabled = false` and leaves `share_token` alone, so
ticking it again hands out the same `/s/:token` URL instead of a fresh one. That's deliberate —
a link pinned in a group chat survives the collection going quiet for a month — but it means
switching the link off is not how you retire an address that got out. It hides it, and the next
tick republishes it verbatim.

**Rotate link** is how you retire one. `rotateShareTokenAction` writes a new `nanoid(24)` over
the old token, and `getCollectionByShareToken` matches on the token, so the previous URL stops
resolving the moment the rotation lands — for everyone, including the people you meant to share
it with. There is no grace period and no alias table: half-invalidating a leaked link would be
worse than not offering the control.

The control appears whenever a token exists, not only while the link is switched on. The owner
most likely to reach for it is the one who noticed the leak and unticked the box first, and
gating rotation behind the checkbox would have made them republish the leaked URL to get at the
control that replaces it. When the link is off, the card says so and says the address is
remembered, since a "Rotate link" button next to no visible URL otherwise reads as dead UI.

Neither action returns the new token to the client. `togglePublicLinkAction` and
`rotateShareTokenAction` both call `refresh()`, and `/account` rebuilds the URL from the token
and the request origin (`src/lib/request-origin.ts`) — that's why enabling a link for a
collection that never had one shows its address immediately rather than after a manual reload,
and why the displayed URL changes under a rotation without the card tracking a token in state.

## Invites are emailed, and their links can be copied

Inviting someone from the Sharing card writes the membership row and then mails the
invitee: who invited them, to which collection, whether they can view or edit, the link,
and that it expires in 14 days. The link is absolute and built from `requestOrigin()`,
like a share link and for the same reason: the image has no origin of its own. The 14 is
`INVITE_TTL_DAYS` in `src/db/queries/members.ts`, the same constant `acceptInvite`
checks, so the email can't promise a window the server doesn't keep.

**A failed send keeps the invite.** The row is a working invite whether or not mail went
out, so an SMTP outage doesn't roll it back. That would throw away something that works
and make the owner start over. `inviteMemberAction` returns what happened to the email
(`sent`, `not_configured` or `failed`) and the card says which. "Failed" logs the SMTP
error for the operator and tells the owner to copy the link instead. "Not configured"
says the instance doesn't send mail, which is the truth on most self-hosted installs.

**Every pending invite has a Copy invite link button**, mail or no mail. It's how sharing
works on an instance without SMTP, and the way round a spam folder or a mistyped address.
The URL is built on the server, as `shareUrl` is. The page is owner-only, so showing the
token there exposes nothing the owner couldn't already mint. An expired invite shows
"Expired" and no button, because copying a dead link helps nobody.

**Resending is inviting again.** `inviteMember` upserts on (collection, email). For a
pending invite that mints a new token, restarts the 14 days and takes the role asked for
this time, so the old link dies and the new email carries the only one that works.

**Inviting someone who has already accepted does nothing.** The same upsert used to set
`acceptedAt` back to null. `resolveRole` requires it, so typing a member's address in
again silently revoked their access until they accepted again. With invites sending mail
that would have become "they lost access and got an email". The upsert now carries
`setWhere: isNull(acceptedAt)`, so an accepted row is left exactly as it was and comes
back with `acceptedAt` set. The action sends nothing and the card says they already have
access. Role changes have their own control in the member list. The skip is part of the
`INSERT … ON CONFLICT` rather than a read before the write, so an accept landing between
the two can't slip past it.
