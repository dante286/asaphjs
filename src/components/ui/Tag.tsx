import type { ReactNode } from "react";

export function Tag({
  variant = "neutral",
  children,
}: {
  variant?: "accent" | "accent-2" | "neutral" | "outline";
  children: ReactNode;
}) {
  return <span className={`tag tag-${variant}`}>{children}</span>;
}
