"use client";

import { useState, useTransition } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { Dialog } from "@/components/ui/Dialog";
import {
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
};

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
    const email = inviteEmail.trim();
    startTransition(async () => {
      await inviteMemberAction(collectionId, email, inviteRole);
      setMembers((prev) => [
        ...prev.filter((m) => m.invitedEmail !== email.toLowerCase()),
        { invitedEmail: email.toLowerCase(), role: inviteRole, userName: null, acceptedAt: null },
      ]);
      setInviteEmail("");
    });
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
            <span className="tag tag-neutral">{m.acceptedAt ? "Accepted" : "Invited"}</span>
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
