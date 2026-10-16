"use client";

import { useState, useTransition } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { Dialog } from "@/components/ui/Dialog";
import {
  type InviteResult,
  inviteMemberAction,
  removeMemberAction,
  rotateShareTokenAction,
  togglePublicLinkAction,
  updateMemberRoleAction,
} from "@/actions/members";

export type MemberRow = {
  invitedEmail: string;
  role: string;
  userName: string | null;
  acceptedAt: string | Date | null;
  /**
   * A pending invite's link, absolute and built on the server like `shareUrl`.
   * Null once accepted, and once expired — inviting again mints a fresh one.
   */
  inviteUrl: string | null;
  expired: boolean;
};

/** What the owner is told after Invite, keyed by what happened to the email. */
function inviteNotice(result: InviteResult, email: string): { text: string; warn: boolean } {
  if (!result.ok) {
    // Re-inviting used to reset an accepted member and revoke their access;
    // now the query leaves them be, and this says why nothing happened.
    return { text: `${email} already has access — change their role in the list above.`, warn: false };
  }
  switch (result.email) {
    case "sent":
      return { text: `Invite sent to ${email}.`, warn: false };
    case "not_configured":
      return {
        text: "Invite saved. This instance doesn't send email, so copy the link below and send it yourself.",
        warn: false,
      };
    case "failed":
      return { text: "Invite saved, but the email didn't send — copy the link below instead.", warn: true };
  }
}

export function SharingCard({
  collectionId,
  collectionName,
  itemCount,
  shareEnabled: initialShareEnabled,
  shareUrl,
  members: initialMembers,
}: {
  collectionId: string;
  collectionName: string;
  itemCount: number;
  shareEnabled: boolean;
  /**
   * Built on the server from the request's own origin. Not held in state: both
   * enabling the link (which mints a token) and rotating it change the token
   * server-side, and the action re-renders the page so the URL arrives as a new
   * prop — state initialised once would have kept showing the token that didn't
   * exist yet, or the one that was just replaced.
   */
  shareUrl: string | null;
  members: MemberRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [shareEnabled, setShareEnabled] = useState(initialShareEnabled);
  const [members, setMembers] = useState(initialMembers);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);

  function togglePublic() {
    const next = !shareEnabled;
    setRotated(false);
    setShareEnabled(next);
    startTransition(() => togglePublicLinkAction(collectionId, next));
  }

  function rotate() {
    setRotateError(null);
    startTransition(async () => {
      try {
        await rotateShareTokenAction(collectionId);
        setCopied(false);
        setRotated(true);
        setRotateOpen(false);
      } catch {
        // Silence here would be the worst kind: the owner closes the dialog
        // believing the leaked address is dead while it still resolves.
        setRotateError("Couldn't rotate this link — the old address still works.");
        setRotateOpen(false);
      }
    });
  }

  function invite() {
    if (!inviteEmail.trim()) return;
    const email = inviteEmail.trim().toLowerCase();
    setNotice(null);
    startTransition(async () => {
      let result: InviteResult;
      try {
        result = await inviteMemberAction(collectionId, email, inviteRole);
      } catch {
        setNotice({ text: `Couldn't invite ${email}. Try again.`, warn: true });
        return;
      }
      setNotice(inviteNotice(result, email));
      if (result.ok) {
        const invited = result;
        setMembers((prev) => [
          ...prev.filter((m) => m.invitedEmail !== invited.invitedEmail),
          {
            invitedEmail: invited.invitedEmail,
            role: invited.role,
            userName: null,
            acceptedAt: null,
            inviteUrl: invited.inviteUrl,
            expired: false,
          },
        ]);
      }
      setInviteEmail("");
    });
  }

  function copyInvite(m: MemberRow) {
    if (!m.inviteUrl) return;
    navigator.clipboard.writeText(m.inviteUrl);
    setCopiedInvite(m.invitedEmail);
    setTimeout(() => setCopiedInvite((current) => (current === m.invitedEmail ? null : current)), 1500);
  }

  function changeRole(email: string, role: "viewer" | "editor" | "remove") {
    if (role === "remove") {
      startTransition(async () => {
        await removeMemberAction(collectionId, email);
        setMembers((prev) => prev.filter((m) => m.invitedEmail !== email));
      });
      return;
    }
    startTransition(async () => {
      await updateMemberRoleAction(collectionId, email, role);
      setMembers((prev) => prev.map((m) => (m.invitedEmail === email ? { ...m, role } : m)));
    });
  }

  return (
    <Blueprint style={{ padding: "16px 18px 18px", marginBottom: 26, display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 19 }}>{collectionName}</span>
        <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          {itemCount} item{itemCount === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={shareEnabled} onChange={togglePublic} disabled={isPending} />
            Public link
          </label>
          {shareEnabled && shareUrl && (
            <>
              <span style={{ fontSize: 12.5, color: "var(--color-accent-700)" }}>{shareUrl}</span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </>
          )}
          {/* Offered whenever a token exists, not only while the link is on: switching
              the link off keeps the address, so an owner who has already hidden a leaked
              link would otherwise have to republish it to be able to replace it. */}
          {shareUrl && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "#b5544a" }}
              type="button"
              disabled={isPending}
              onClick={() => {
                setRotateError(null);
                setRotated(false);
                setRotateOpen(true);
              }}
            >
              Rotate link
            </button>
          )}
          {rotated && (
            <span style={{ fontSize: 12, color: "var(--color-accent-700)" }}>New address issued.</span>
          )}
          {rotateError && <span style={{ fontSize: 12, color: "#b5544a" }}>{rotateError}</span>}
        </div>
        {!shareEnabled && shareUrl && (
          <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
            The link is off, but its address is remembered — switching it back on hands out the
            same URL. Rotate it if that URL got out.
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {members.map((m) => (
          <div key={m.invitedEmail} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
            <span
              style={{
                width: 26,
                height: 26,
                display: "grid",
                placeItems: "center",
                background: "var(--color-accent-200)",
                fontFamily: "var(--font-heading)",
                fontSize: 12,
              }}
            >
              {(m.userName ?? m.invitedEmail).slice(0, 2).toUpperCase()}
            </span>
            <span style={{ minWidth: 0 }}>{m.invitedEmail}</span>
            <span className="tag tag-neutral">{m.acceptedAt ? "Accepted" : m.expired ? "Expired" : "Invited"}</span>
            {/* On every pending invite, mail or no mail: it's how sharing works on an
                instance with no SMTP, and the way round a spam folder or a typo. */}
            {m.inviteUrl && (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => copyInvite(m)}>
                {copiedInvite === m.invitedEmail ? "Copied" : "Copy invite link"}
              </button>
            )}
            {m.expired && <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>Invite again to send a new link.</span>}
            <select
              className="input"
              value={m.role}
              onChange={(e) => changeRole(m.invitedEmail, e.target.value as "viewer" | "editor" | "remove")}
              style={{ marginLeft: "auto", height: 30, paddingBlock: 0, fontSize: 12.5, width: 130 }}
            >
              <option value="viewer">Can view</option>
              <option value="editor">Can edit</option>
              <option value="remove">Remove access</option>
            </select>
          </div>
        ))}
        {members.length === 0 && (
          <div style={{ fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>
            Not shared with anyone yet.
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="input"
          type="email"
          placeholder="Invite by email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          style={{ flex: "1 1 190px", height: 34 }}
        />
        <select
          className="input"
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as "viewer" | "editor")}
          style={{ flex: "0 1 130px", height: 34, paddingBlock: 0, fontSize: 12.5 }}
        >
          <option value="viewer">Can view</option>
          <option value="editor">Can edit</option>
        </select>
        <button className="btn btn-secondary" style={{ height: 34 }} type="button" onClick={invite} disabled={isPending}>
          Invite
        </button>
      </div>
      {notice && (
        <span role="status" style={{ fontSize: 12, marginTop: -10, color: notice.warn ? "#b5544a" : "var(--color-accent-700)" }}>
          {notice.text}
        </span>
      )}

      {rotateOpen && (
        <Dialog
          open
          onClose={() => {
            if (!isPending) setRotateOpen(false);
          }}
          title="Rotate the public link?"
          actions={
            <>
              <button className="btn btn-ghost" type="button" disabled={isPending} onClick={() => setRotateOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" disabled={isPending} onClick={rotate}>
                {isPending ? "Rotating…" : "Rotate link"}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {collectionName} gets a new address and the current one stops working — that being
            the point. Anyone still holding the old link, including people you meant to share it
            with, will need the new one. Nothing else about this collection changes, and the
            people you invited by email keep their access.
          </p>
        </Dialog>
      )}
    </Blueprint>
  );
}
