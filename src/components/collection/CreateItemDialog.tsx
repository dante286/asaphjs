"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Blueprint } from "@/components/ui/Blueprint";
import { Dialog } from "@/components/ui/Dialog";
import { FieldCell } from "@/components/collection/FieldCell";
import { LookupCandidateList } from "@/components/collection/LookupCandidateList";
import { previewLookupForDraftAction } from "@/actions/metadata";
import { MIN_LOOKUP_QUERY_LENGTH, searchLookupRequest } from "@/lib/api/lookup-client";
import { isBlankValue } from "@/lib/metadata/prefill";
import { isFixedColumnField, isTitleField } from "@/lib/fields/item-values";
import type { Item, ItemDraft } from "@/lib/api/items-client";
import type { FieldDef } from "@/lib/fields/field-def";
import type { LookupConfig } from "@/lib/metadata/lookup-config";
import type { Candidate } from "@/lib/metadata/types";

const MUTED = "color-mix(in srgb, var(--color-text) 55%, transparent)";
const ROW_LABEL: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: MUTED,
};

type Draft = {
  title: string;
  values: Record<string, unknown>;
  verified: boolean;
  borrower: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = { title: "", values: {}, verified: false, borrower: "", notes: "" };

type Match = {
  sourceId: string;
  /** What the provider calls it — the picked row, echoed back as confirmation. */
  title: string;
  coverUrl: string | null;
  filled: string[];
  keptExisting: string[];
};

/**
 * Everything an item needs, before it exists. The old flow created a row from a
 * title prompt and left the owner to find it in the grid and open it to fill in
 * the rest; this collects what the detail page collects — plus the provider
 * match that fills most of it — and writes the row once, complete.
 */
export function CreateItemDialog({
  onClose,
  onCreate,
  collectionId,
  fields,
  lookup,
}: {
  onClose: () => void;
  onCreate: (draft: ItemDraft) => Promise<Item>;
  collectionId: string;
  fields: FieldDef[];
  /** null when this collection's template has no provider, or its keys aren't set. */
  lookup: LookupConfig | null;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // FieldCell inputs are uncontrolled, so values a lookup fills in only show up
  // on a remount — this bumps to give the whole grid a fresh key.
  const [formKey, setFormKey] = useState(0);
  const [match, setMatch] = useState<Match | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const detailFields = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field, index }) => !isTitleField(index) && !isFixedColumnField(field.id));
  const titleLabel = fields[0]?.label ?? "Title";
  const busy = saving || applying;

  function reset() {
    setDraft(EMPTY_DRAFT);
    setMatch(null);
    setSearchOpen(false);
    setSearching(false);
    setQuery("");
    setCandidates(null);
    setError(null);
    setFormKey((k) => k + 1);
  }

  // Mounted only while it's open (see ItemsExplorer), so every open starts on a
  // fresh draft and there's nothing to reset here — just the in-flight search to
  // drop if the dialog closes mid-lookup.
  useEffect(() => () => inFlight.current?.abort(), []);

  async function runSearch(term: string) {
    if (!lookup) return;
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
    try {
      setCandidates(await searchLookupRequest(lookup.key, trimmed, controller.signal));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function openSearch() {
    setSearchOpen(true);
    setQuery(draft.title);
    setCandidates(null);
    // One deliberate click, one search — the same discipline as the detail
    // page's panel, because every uncached query counts against the free tier.
    if (draft.title.trim().length >= MIN_LOOKUP_QUERY_LENGTH) runSearch(draft.title);
  }

  function closeSearch() {
    inFlight.current?.abort();
    setSearching(false);
    setSearchOpen(false);
  }

  async function pickCandidate(candidate: Candidate) {
    setApplying(true);
    setError(null);
    try {
      const preview = await previewLookupForDraftAction({ collectionId, sourceId: candidate.sourceId });

      // Blank-only, the rule the detail page's lookup follows too: whatever is
      // already typed into the dialog outranks what the provider knows.
      const values = { ...draft.values };
      const filled: string[] = [];
      const keptExisting: string[] = [];
      for (const { field } of detailFields) {
        if (!(field.id in preview.values)) continue;
        if (isBlankValue(values[field.id])) {
          values[field.id] = preview.values[field.id];
          filled.push(field.label);
        } else {
          keptExisting.push(field.label);
        }
      }

      const previewTitle = preview.title?.trim() ?? "";
      const takesTitle = previewTitle !== "" && draft.title.trim() === "";
      if (takesTitle) filled.push(titleLabel);
      else if (previewTitle !== "") keptExisting.push(titleLabel);

      setDraft({ ...draft, title: takesTitle ? previewTitle : draft.title, values });
      setFormKey((k) => k + 1);
      setMatch({
        sourceId: candidate.sourceId,
        title: candidate.title,
        coverUrl: preview.coverUrl ?? candidate.coverUrl ?? null,
        filled,
        keptExisting,
      });
      closeSearch();
      setCandidates(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that match.");
    } finally {
      setApplying(false);
    }
  }

  async function save(addAnother: boolean) {
    const title = draft.title.trim();
    if (!title) {
      setError(`${titleLabel} is required.`);
      titleRef.current?.focus();
      return;
    }

    setError(null);
    setSaving(true);
    try {
      // Untouched cells stay absent rather than landing as "" — an empty string
      // reads as a filled-in value everywhere else (the breakdown panel, the
      // lookup's fills-blanks-only rule, the covers grid).
      const values = Object.fromEntries(
        Object.entries(draft.values).filter(([, value]) => !isBlankValue(value)),
      );

      await onCreate({
        title,
        values,
        verified: draft.verified,
        borrower: draft.borrower.trim() || null,
        notes: draft.notes.trim() || null,
        match: match ? { sourceId: match.sourceId } : undefined,
      });

      if (addAnother) {
        reset();
        setAdded(title);
        titleRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Add item"
      width={640}
      // The negative margin pays back the padding, which is only there so the
      // blueprint frame below can draw its registration marks outside its box
      // without the scroll container clipping them.
      bodyStyle={{ opacity: 1, maxHeight: "min(64vh,620px)", overflowY: "auto", padding: 8, margin: -8 }}
      actions={
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(true)}>
            Save &amp; add another
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(false)}>
            {saving ? "Adding…" : "Add item"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        style={{ display: "grid", gap: 16 }}
      >
        <div className="field" style={{ gap: 4 }}>
          <label style={ROW_LABEL}>{titleLabel}</label>
          <input
            ref={titleRef}
            className="input"
            type="text"
            autoFocus
            value={draft.title}
            placeholder="What are you adding?"
            disabled={saving}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          />
        </div>

        {lookup && (
          <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            {match ? (
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 10, alignItems: "start" }}>
                {match.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={match.coverUrl}
                    alt=""
                    style={{ width: 44, height: 58, objectFit: "cover", background: "var(--color-neutral-200)" }}
                  />
                ) : (
                  <div style={{ width: 44, height: 58, background: "var(--color-neutral-200)" }} />
                )}
                <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
                  <div>
                    Matched to <strong>{match.title}</strong> on {lookup.label}
                  </div>
                  <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
                    {match.filled.length > 0
                      ? `Filled ${match.filled.join(", ")}.`
                      : "Nothing left to fill in — you had it all."}
                    {match.keptExisting.length > 0 && ` Left ${match.keptExisting.join(", ")} as you typed it.`}
                    {" The cover art is saved with the item."}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={openSearch}>
                      Change match
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, color: "var(--color-accent-700)" }}
                      disabled={busy}
                      onClick={() => setMatch(null)}
                    >
                      Clear match
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              !searchOpen && (
                <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12.5 }}
                    disabled={busy}
                    onClick={openSearch}
                  >
                    Find on {lookup.label}
                  </button>
                  <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45 }}>
                    Fills in the fields below and the cover art. Anything you&rsquo;ve already typed is left alone.
                  </div>
                </div>
              )
            )}

            {searchOpen && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input"
                    type="search"
                    value={query}
                    placeholder={`Search ${lookup.label}`}
                    disabled={busy}
                    onChange={(e) => setQuery(e.target.value)}
                    // Enter searches instead of submitting the item — a nested
                    // <form> isn't legal HTML, so the key is handled directly.
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      runSearch(query);
                    }}
                    style={{ height: 32, minWidth: 0 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12 }}
                    disabled={busy || searching}
                    onClick={() => runSearch(query)}
                  >
                    {searching ? "…" : "Search"}
                  </button>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={closeSearch}>
                    Cancel
                  </button>
                </div>
                {candidates && !searching && (
                  <LookupCandidateList
                    candidates={candidates}
                    actionLabel={applying ? "…" : "Use"}
                    disabled={busy}
                    onPick={pickCandidate}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {detailFields.length > 0 && (
          // Same frame the item detail page puts its details grid in, so a row
          // you type into here looks like the row you'd edit there.
          <Blueprint style={{ padding: "2px 16px 12px" }}>
            <div style={{ display: "grid", gap: 1 }} key={formKey}>
              {detailFields.map(({ field, index }) => (
                <div
                  key={field.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(110px,170px) 1fr",
                    gap: 14,
                    alignItems: "center",
                    padding: "7px 0",
                    borderBottom: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
                  }}
                >
                  <span style={ROW_LABEL}>{field.label}</span>
                  <FieldCell
                    item={{
                      title: draft.title,
                      verified: draft.verified,
                      borrower: draft.borrower || null,
                      notes: draft.notes || null,
                      values: draft.values,
                    }}
                    field={field}
                    index={index}
                    disabled={saving}
                    onChange={(value) =>
                      setDraft((prev) => ({ ...prev, values: { ...prev.values, [field.id]: value } }))
                    }
                  />
                </div>
              ))}
            </div>
          </Blueprint>
        )}

        <div style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={draft.verified}
              disabled={saving}
              onChange={(e) => setDraft((prev) => ({ ...prev, verified: e.target.checked }))}
              style={{ accentColor: "var(--color-accent)", width: 16, height: 16 }}
            />
            Verified — physically confirmed
          </label>
          <div className="field" style={{ gap: 4 }}>
            <label style={ROW_LABEL}>Lent to</label>
            <input
              className="input"
              type="text"
              value={draft.borrower}
              placeholder="Nobody — in your possession"
              disabled={saving}
              onChange={(e) => setDraft((prev) => ({ ...prev, borrower: e.target.value }))}
              style={{ height: 32 }}
            />
          </div>
          <div className="field" style={{ gap: 4 }}>
            <label style={ROW_LABEL}>Notes</label>
            <textarea
              className="input"
              value={draft.notes}
              placeholder="Condition, where you bought it, what's still missing from the set…"
              disabled={saving}
              onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
              style={{ minHeight: 64, resize: "vertical", fontFamily: "var(--font-body)", lineHeight: 1.5 }}
            />
          </div>
        </div>

        {added && !error && (
          <div style={{ fontSize: 11.5, color: MUTED }}>
            Added &ldquo;{added}&rdquo; — this one&rsquo;s blank and ready.
          </div>
        )}
        {error && <div style={{ fontSize: 11.5, color: "#b5544a", lineHeight: 1.4 }}>{error}</div>}

        {/* Enter in any of the inputs above should add the item; the visible
            buttons live in the dialog's own action row, outside this form. */}
        <button type="submit" style={{ display: "none" }} aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
