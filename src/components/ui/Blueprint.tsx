import type { CSSProperties, ElementType, ReactNode } from "react";

export function Blueprint({
  as: As = "div",
  className = "",
  style,
  children,
  onClick,
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <As className={`blueprint ${className}`.trim()} style={style} onClick={onClick}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </As>
  );
}
