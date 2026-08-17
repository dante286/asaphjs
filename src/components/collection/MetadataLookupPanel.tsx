"use client";

import { useRef, useState, useTransition, type CSSProperties } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import type { SaveStatus } from "@/components/collection/SaveStatusIndicator";
import { applyLookupAction, clearLookupMatchAction, rerunLookupAction, type LookupApplyResult } from "@/actions/metadata";
import { MIN_LOOKUP_QUERY_LENGTH, searchLookupRequest } from "@/lib/api/lookup-client";
import type { Item } from "@/lib/api/items-client";
import type { Candidate } from "@/lib/metadata/types";
import type { LookupConfig } from "@/lib/metadata/lookup-config";

const MUTED = "color-mix(in srgb, var(--color-text) 55%, transparent)";
const LABEL: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: MUTED,
};

/**
 * Matching an item against its collection's metadata provider. Searches are
 * only ever run on an explicit click — never as-you-type — because every
 * uncached query counts against the provider's free tier, and the field is
 * pre-filled with the item's title so the common case is one click anyway.
 */
export function MetadataLookupPanel({
  collectionId,
  item,
  lookup,
  canEdit,
  onItemUpdate,
  onStatusChange,
}: {
  collectionId: string;
  item: Item;
  lookup: LookupConfig;
  canEdit: boolean;
  onItemUpdate: (item: Item) => void;
  onStatusChange: (status: SaveStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(item.title);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LookupApplyResult | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef<AbortController | null>(null);

  const matched = item.externalRef;
  const busy = pending || searching;

  async function runSearch(term: string) {
    const trimmed = term.trim();
    if (trimmed.length < MIN_LOOKUP_QUERY_LENGTH) {
      setError(`Type at least ${MIN_LOOKUP_QUERY_LENGTH} characters to search.`);
      return;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setSearching(true);
    setError(null);
    setSummary(null);
    try {
      setCandidates(await searchLookupRequest(lookup.key, trimmed, controller.signal));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function openPanel() {
    setOpen(true);
    // One deliberate click, one search — the title is almost always the query.
    if (candidates === null) runSearch(item.title);
  }

  function run(work: () => Promise<LookupApplyResult>) {
    setError(null);
    onStatusChange({ kind: "saving" });
    startTransition(async () => {
      try {
        const result = await work();
        onItemUpdate(result.item);
        setSummary(result);
        setCandidates(null);
        setOpen(false);
        onStatusChange({ kind: "saved", at: new Date() });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't apply that match.");
        onStatusChange({ kind: "error" });
      }
    });
  }

  function handleApply(candidate: Candidate) {
    run(() =>
      applyLookupAction({
        collectionId,
        itemId: item.id,
        sourceId: candidate.sourceId,
        overwrite,
        ifMatchUpdatedAt: item.updatedAt,
      }),
    );
  }

  function handleRerun() {
    run(() => rerunLookupAction({ collectionId, itemId: item.id, ifMatchUpdatedAt: item.updatedAt }));
  }

  function handleUnlink() {
    setError(null);
    onStatusChange({ kind: "saving" });
    startTransition(async () => {
      try {
        onItemUpdate(
          await clearLookupMatchAction({ collectionId, itemId: item.id, ifMatchUpdatedAt: item.updatedAt }),
        );
        setSummary(null);
        onStatusChange({ kind: "saved", at: new Date() });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't unlink that match.");
        onStatusChange({ kind: "error" });
      }
    });
  }

  if (!canEdit) return null;

  return (
    <Blueprint style={{ padding: "12px 14px", display: "grid", gap: 10, fontSize: 12.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={LABEL}>Metadata</span>
        <span style={{ fontSize: 11, color: MUTED }}>{lookup.label}</span>
      </div>

      {matched ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ color: MUTED, lineHeight: 1.45 }}>
            Matched to {lookup.label} #{matched.id} · {new Date(matched.fetchedAt).toLocaleDateString()}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={handleRerun}>
              {pending ? "Working…" : "Re-run lookup"}
            </button>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={openPanel}>
              Change match
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "var(--color-accent-700)" }}
              disabled={busy}
              onClick={handleUnlink}
            >
              Unlink
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
            Re-run refetches past the cache and overwrites the fields {lookup.label} covers.
          </div>
        </div>
      ) : (
        !open && (
          <div style={{ display: "grid", gap: 6 }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: 12.5 }} disabled={busy} onClick={openPanel}>
              Find on {lookup.label}
            </button>
            <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
              Fills in blank fields and the cover art. Anything you&rsquo;ve already typed is left alone.
            </div>
          </div>
        )
      )}

      {open && (
        <div style={{ display: "grid", gap: 8, paddingTop: matched ? 8 : 0, borderTop: matched ? "1px solid var(--color-divider)" : undefined }}>
          <form
            style={{ display: "flex", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
          >
            <input
              className="input"
              type="search"
              value={query}
              placeholder={`Search ${lookup.label}`}
              onChange={(e) => setQuery(e.target.value)}
              style={{ height: 32, minWidth: 0 }}
            />
            <button type="submit" className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy}>
              {searching ? "…" : "Search"}
            </button>
          </form>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11.5, color: MUTED }}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              style={{ accentColor: "var(--color-accent)", width: 14, height: 14 }}
            />
            Overwrite fields that already have a value
          </label>

          {candidates?.length === 0 && !searching && (
            <div style={{ color: MUTED }}>No matches. Try a shorter or more exact title.</div>
          )}

          {candidates?.map((candidate) => (
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
                disabled={busy}
                onClick={() => handleApply(candidate)}
              >
                Apply
              </button>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, justifySelf: "start" }}
            disabled={pending}
            onClick={() => {
              inFlight.current?.abort();
              setOpen(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {summary && (
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
          {summary.applied.length > 0 ? `Filled ${summary.applied.join(", ")}.` : "Nothing to fill — everything already matched."}
          {summary.keptExisting.length > 0 && ` Left ${summary.keptExisting.join(", ")} as you had it.`}
        </div>
      )}

      {error && <div style={{ fontSize: 11.5, color: "#b5544a", lineHeight: 1.4 }}>{error}</div>}
    </Blueprint>
  );
}
