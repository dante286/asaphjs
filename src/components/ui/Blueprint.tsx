import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";

export function Blueprint({
  as: As = "div",
  className = "",
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "style" | "children">) {
  return (
    <As className={`blueprint ${className}`.trim()} style={style} {...rest}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </As>
  );
}
