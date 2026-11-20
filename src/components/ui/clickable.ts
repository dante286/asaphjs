import type { KeyboardEvent } from "react";

/**
 * Props that make a non-button element (a card, a tile, a drop zone) behave
 * like a button for keyboard users: focusable with Tab, announced as a button,
 * and activated by Enter or Space as well as a click.
 *
 * A real `<button>` would do this natively, but these are styled blocks with
 * block content, and a button's UA styles and content model fight that.
 */
export function clickableProps(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // Only when the element itself has focus, not a control inside it.
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        // Space would otherwise scroll the page.
        e.preventDefault();
        onActivate();
      }
    },
  };
}
