export type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error" };

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status.kind === "idle") return null;

  if (status.kind === "saving") {
    return <span style={{ fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>Saving…</span>;
  }

  if (status.kind === "error") {
    return <span style={{ fontSize: 11.5, color: "#b5544a" }}>Couldn&rsquo;t save — retrying</span>;
  }

  const hh = String(status.at.getHours()).padStart(2, "0");
  const mm = String(status.at.getMinutes()).padStart(2, "0");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-accent-700)" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
      Saved {hh}:{mm}
    </span>
  );
}
