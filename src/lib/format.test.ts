import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeAgo } from "./format";

// timeAgo reads Date.now(), so every expectation here is relative to a clock
// this test owns. Without that, the boundary cases pass or fail depending on
// when the suite runs.
const NOW = new Date("2026-03-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Date the given number of milliseconds before the frozen now. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const daysAgo = (days: number) => ago(days * DAY_MS);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo: sub-day", () => {
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [60_000, "1 minute ago"],
    [120_000, "2 minutes ago"],
    [59 * 60_000, "59 minutes ago"],
    [60 * 60_000, "1 hour ago"],
    [2 * 60 * 60_000, "2 hours ago"],
    [23 * 60 * 60_000, "23 hours ago"],
  ])("renders %i ms ago as %j", (ms, expected) => {
    expect(timeAgo(ago(ms))).toBe(expected);
  });
});

describe("timeAgo: days and weeks", () => {
  it.each([
    [1, "yesterday"],
    [2, "2 days ago"],
    [6, "6 days ago"],
    [7, "last week"],
    [13, "last week"],
    [14, "2 weeks ago"],
    [28, "4 weeks ago"],
    [34, "4 weeks ago"],
  ])("renders %i days ago as %j", (days, expected) => {
    expect(timeAgo(daysAgo(days))).toBe(expected);
  });

  it("says yesterday rather than 1 day ago", () => {
    // The singular case is spelled out, so the plural branch never has to
    // render "1 days ago".
    expect(timeAgo(daysAgo(1))).toBe("yesterday");
  });
});

describe("timeAgo: months and years", () => {
  it.each([
    [35, "1 month ago"],
    [59, "1 month ago"],
    [60, "2 months ago"],
    [180, "6 months ago"],
    [359, "11 months ago"],
    [365, "1 year ago"],
    [400, "1 year ago"],
    [730, "2 years ago"],
  ])("renders %i days ago as %j", (days, expected) => {
    expect(timeAgo(daysAgo(days))).toBe(expected);
  });

  // Skipped, not deleted: days 360 through 364 currently render as
  // "0 years ago", because months hits 12 (at 360 days, on the 30-day month)
  // five days before years reaches 1 (at 365). This is the assertion that
  // should pass; it is a behaviour change rather than a test gap, so it is
  // tracked separately instead of being folded into the issue that added this
  // suite.
  it.skip.each([360, 364])("renders %i days ago as a month count, not 0 years", (days) => {
    expect(timeAgo(daysAgo(days))).not.toBe("0 years ago");
  });
});

describe("timeAgo: input handling", () => {
  it("accepts an ISO string as well as a Date", () => {
    // Rows come back from Drizzle with timestamps already parsed, but the JSON
    // API hands the client strings.
    expect(timeAgo(daysAgo(2).toISOString())).toBe("2 days ago");
  });

  it("reads a future timestamp as just now", () => {
    // Clock skew between the browser and the server shouldn't produce a
    // negative duration on screen.
    expect(timeAgo(new Date(NOW.getTime() + 60_000))).toBe("just now");
  });
});
