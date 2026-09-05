import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

/**
 * The cases that matter here are the ones that don't look absolute — see the
 * docblock in the module for why `//host` and `/\host` both leave the origin
 * despite starting with a slash.
 */
describe("safeNext", () => {
  it("keeps the paths the middleware actually sets", () => {
    // `?next=` is written from `request.nextUrl.pathname`, so these are the
    // real inputs; everything below is someone else's.
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/collections/video-games")).toBe("/collections/video-games");
  });

  it("keeps a query string and fragment on a local path", () => {
    expect(safeNext("/collections/x?view=grid#row-3")).toBe("/collections/x?view=grid#row-3");
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://elsewhere.example/login")).toBe("/");
    expect(safeNext("http://elsewhere.example")).toBe("/");
  });

  it("refuses a protocol-relative host", () => {
    // Starts with a slash and contains no scheme, which is what makes it the
    // one worth having a test for.
    expect(safeNext("//elsewhere.example")).toBe("/");
    expect(safeNext("//elsewhere.example/login")).toBe("/");
  });

  it("refuses the backslash spellings a browser normalises into that", () => {
    expect(safeNext("/\\elsewhere.example")).toBe("/");
    expect(safeNext("/\\/elsewhere.example")).toBe("/");
    expect(safeNext("\\\\elsewhere.example")).toBe("/");
  });

  it("refuses a scheme that isn't a location at all", () => {
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("sends anything that isn't a path to the dashboard", () => {
    // Including the empty string, which is what an /auth opened directly
    // submits — the common case, not an attack.
    expect(safeNext("")).toBe("/");
    expect(safeNext("account")).toBe("/");
  });
});
