"use client";

import type { Candidate } from "@/lib/metadata/types";

const MUTED = "color-mix(in srgb, var(--color-text) 55%, transparent)";

/**
 * The provider search results picker, shared by the item detail page's lookup
 * panel (which applies a match to a saved item) and the create dialog (which
 * pre-fills a draft with one) so the two can't drift apart on what a candidate
 * looks like.
 */
export function LookupCandidateList({
  candidates,
  actionLabel,
  disabled,
  onPick,
}: {
  candidates: Candidate[];
  actionLabel: string;
  disabled: boolean;
  onPick: (candidate: Candidate) => void;
}) {
  if (candidates.length === 0) {
    return <div style={{ color: MUTED }}>No matches. Try a shorter or more exact title.</div>;
  }

  return (
    <>
      {candidates.map((candidate) => (
        <div
          key={candidate.sourceId}
          style={{
            display: "grid",
            gridTemplateColumns: "34px 1fr auto",
            gap: 8,
            alignItems: "center",
            padding: "6px 0",
            borderTop: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
          }}
        >
          {candidate.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={candidate.coverUrl}
              alt=""
              style={{ width: 34, height: 45, objectFit: "cover", background: "var(--color-neutral-200)" }}
            />
          ) : (
            <div style={{ width: 34, height: 45, background: "var(--color-neutral-200)" }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ lineHeight: 1.3 }}>{candidate.title}</div>
            <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.35 }}>
              {[candidate.year, candidate.subtitle].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            disabled={disabled}
            onClick={() => onPick(candidate)}
          >
            {actionLabel}
          </button>
        </div>
      ))}
    </>
  );
}
