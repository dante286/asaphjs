import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { clickableProps } from "./clickable";

function keyEvent(key: string, { onSelf = true } = {}) {
  const el = {};
  return {
    key,
    target: el,
    currentTarget: onSelf ? el : {},
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("clickableProps", () => {
  it("is a focusable button", () => {
    expect(clickableProps(() => {})).toMatchObject({ role: "button", tabIndex: 0 });
  });

  it("activates on Enter and Space, and keeps Space from scrolling", () => {
    const onActivate = vi.fn();
    const { onKeyDown } = clickableProps(onActivate);

    const space = keyEvent(" ");
    onKeyDown(keyEvent("Enter"));
    onKeyDown(space);

    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(space.preventDefault).toHaveBeenCalled();
  });

  it("ignores other keys, and keys meant for a control inside it", () => {
    const onActivate = vi.fn();
    const { onKeyDown } = clickableProps(onActivate);

    onKeyDown(keyEvent("a"));
    onKeyDown(keyEvent("Enter", { onSelf: false }));

    expect(onActivate).not.toHaveBeenCalled();
  });
});
