"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // Hidden by `display: none` (the dialog's own hidden submit, for one).
    (el) => el.getClientRects().length > 0 && el.getAttribute("aria-hidden") !== "true",
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  width,
  bodyStyle,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Widens the default 440px shell for dialogs that carry a form. */
  width?: number;
  bodyStyle?: CSSProperties;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // What had focus before the dialog, to hand it back on close. Read on the
  // first render: by the time an effect runs, React has already applied an
  // `autoFocus` inside the dialog, and that field is what we'd record instead.
  // Every caller mounts the dialog already open, so first render = opening.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // `aria-modal` tells assistive tech the page behind is inert, so focus has to
  // agree: it moves into the dialog on open, Tab cycles inside it, and it goes
  // back to whatever opened the dialog on close.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // An `autoFocus` field inside has already claimed focus; leave it there.
    if (!dialog.contains(document.activeElement)) (focusablesIn(dialog)[0] ?? dialog).focus();

    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusablesIn(dialog);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapTab);

    return () => {
      document.removeEventListener("keydown", trapTab);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, opener]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <div className="dialog-title" id="dialog-title">
          {title}
        </div>
        <div className="dialog-body" style={bodyStyle}>
          {children}
        </div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
