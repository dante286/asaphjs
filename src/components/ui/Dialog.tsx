"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
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
