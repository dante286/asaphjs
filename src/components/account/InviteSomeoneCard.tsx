"use client";

import { useEffect, useState, useTransition } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import {
  type InviteToRegisterActionResult,
  type PendingRegistrationInvite,
  inviteToRegisterAction,
  revokeRegistrationInviteAction,
} from "@/actions/registration-invites";

/** What the inviter is told after Invite or Resend. */
function inviteNotice(result: InviteToRegisterActionResult, email: string, max: number): { text: string; warn: boolean } {
  if (result.ok) {
    return result.invite.notSent
      ? { text: `The email to ${email} didn't send. Try Resend in a minute.`, warn: true }
      : { text: `Invite sent to ${email}.`, warn: false };
  }
  switch (result.reason) {
    case "has_account":
      return { text: `${email} already has an account here.`, warn: false };
    case "already_invited":
      return { text: `Someone else here has already invited ${email}.`, warn: false };
    case "cap":
      return {
        text: `You have ${max} invites waiting. Revoke one, or wait for one to be used or to expire.`,
        warn: true,
      };
    case "cooldown":
      return { text: `An invite went to ${email} moments ago. You can send another in ${result.secondsLeft}s.`, warn: false };
    case "invalid_email":
      return { text: "Enter a valid email address.", warn: true };
    case "unavailable":
      return { text: "Inviting isn't available on this instance right now.", warn: true };
  }
}

export function InviteSomeoneCard({
  invites: initialInvites,
  cooldownSeconds,
  maxPending,
  expiresInDays,
}: {
  invites: PendingRegistrationInvite[];
  cooldownSeconds: number;
  maxPending: number;
  expiresInDays: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [invites, setInvites] = useState(initialInvites);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  // Null until the first tick, so the server render and the first client render
  // agree. A Resend clicked in that first second is refused by the server's own
  // cooldown, which is the one that counts; this only labels the button.
  const [now, setNow] = useState<number | null>(null);

  // Clamped above too: right after a send, `now` can be a stale tick from before it.
  const cooldownLeft = (invite: PendingRegistrationInvite) =>
    now === null
      ? 0
      : Math.min(cooldownSeconds, Math.max(0, Math.ceil((Date.parse(invite.sentAt) + cooldownSeconds * 1000 - now) / 1000)));
  const ticking = now === null || invites.some((invite) => cooldownLeft(invite) > 0);

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  function send(address: string) {
    const target = address.trim().toLowerCase();
    if (!target) return;
    setNotice(null);
    startTransition(async () => {
      let result: InviteToRegisterActionResult;
      try {
        result = await inviteToRegisterAction(target);
      } catch {
        setNotice({ text: `Couldn't invite ${target}. Try again.`, warn: true });
        return;
      }
      setNotice(inviteNotice(result, target, maxPending));
      if (result.ok) {
        const sent = result.invite;
        setInvites((prev) => [sent, ...prev.filter((i) => i.email !== sent.email)]);
        if (target === email.trim().toLowerCase()) setEmail("");
      }
    });
  }

  function revoke(address: string) {
    setNotice(null);
    startTransition(async () => {
      try {
        await revokeRegistrationInviteAction(address);
      } catch {
        setNotice({ text: `Couldn't revoke the invite to ${address}. Try again.`, warn: true });
        return;
      }
      // Gone either way: revoked now, or already used, expired or revoked.
      setInvites((prev) => prev.filter((i) => i.email !== address));
      setNotice({ text: `The invite to ${address} no longer works.`, warn: false });
    });
  }

  return (
    <Blueprint style={{ padding: "16px 18px 18px", marginBottom: 26, display: "grid", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}>
        This instance isn&rsquo;t open for registration. Invite someone by email and they get a link
        that lets that address create an account, once, within {expiresInDays} days.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        {invites.map((invite) => {
          const wait = cooldownLeft(invite);
          return (
            <div key={invite.email} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{invite.email}</span>
              {invite.notSent ? (
                <span className="tag tag-neutral" style={{ color: "#b5544a" }}>
                  Not sent
                </span>
              ) : (
                <span className="tag tag-neutral">Invited</span>
              )}
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12 }}
                  type="button"
                  disabled={isPending || wait > 0}
                  onClick={() => send(invite.email)}
                >
                  {wait > 0 ? `Resend in ${wait}s` : "Resend"}
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "#b5544a" }}
                  type="button"
                  disabled={isPending}
                  onClick={() => revoke(invite.email)}
                >
                  Revoke
                </button>
              </span>
            </div>
          );
        })}
        {invites.length === 0 && (
          <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>
            No invites waiting.
          </div>
        )}
      </div>
      <form
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          send(email);
        }}
      >
        <input
          className="input"
          type="email"
          placeholder="Their email address"
          aria-label="Email address to invite"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: "1 1 220px", height: 34 }}
        />
        <button className="btn btn-secondary" style={{ height: 34 }} type="submit" disabled={isPending}>
          Invite
        </button>
      </form>
      {notice && (
        <span role="status" style={{ fontSize: 12, marginTop: -6, color: notice.warn ? "#b5544a" : "var(--color-accent-700)" }}>
          {notice.text}
        </span>
      )}
    </Blueprint>
  );
}
