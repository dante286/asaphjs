"use client";

import { useEffect, useRef } from "react";

/**
 * Fetches the next page as this scrolls into view, with a margin so the next
 * rows are usually in before the bottom is reached. The button does the same
 * for keyboard and screen-reader users, or anywhere the observer never fires.
 */
export function LoadMore({ onLoadMore, loading }: { onLoadMore: () => unknown; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return;
    // Re-observed after every page lands: if the sentinel is still on screen
    // (a tall viewport, a short page), the fresh observer fires again at once.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, onLoadMore]);

  return (
    <div ref={ref} style={{ display: "flex", justifyContent: "center", padding: "20px 0 8px" }}>
      <button type="button" className="btn btn-secondary" onClick={() => onLoadMore()} disabled={loading} aria-busy={loading}>
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
