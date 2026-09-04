import { describe, expect, it } from "vitest";
import { buildPatchForField, getFieldValue, isFixedColumnField, isTitleField } from "./item-values";
import { field, item } from "@/test/factories";

describe("isTitleField", () => {
  it("is decided by position, not by label", () => {
    // A few templates label column 0 "Name"; it's still the title column.
    expect(isTitleField(0)).toBe(true);
    expect(isTitleField(1)).toBe(false);
  });
});

describe("isFixedColumnField", () => {
  it.each(["verified", "borrower", "comments"])("treats %s as a fixed column", (id) => {
    expect(isFixedColumnField(id)).toBe(true);
  });

  it.each(["title", "genre", "notes", "console"])("treats %s as a values-bag field", (id) => {
    // Note `notes` is not the fixed id — the field is `comments`, which maps
    // onto the notes column.
    expect(isFixedColumnField(id)).toBe(false);
  });
});

describe("getFieldValue", () => {
  const subject = item({
    title: "Chrono Trigger",
    verified: true,
    borrower: "Alex",
    notes: "Boxed copy.",
    values: { console: "SNES" },
  });

  it("reads the title from the fixed column for position 0", () => {
    expect(getFieldValue(subject, field({ id: "name", label: "Name" }), 0)).toBe("Chrono Trigger");
  });

  it.each([
    ["verified", true],
    ["borrower", "Alex"],
    ["comments", "Boxed copy."],
  ])("reads %s from its fixed column", (id, expected) => {
    expect(getFieldValue(subject, field({ id }), 1)).toBe(expected);
  });

  it("reads everything else out of the values bag", () => {
    expect(getFieldValue(subject, field({ id: "console" }), 1)).toBe("SNES");
  });

  it("returns undefined for a field the item has no value for", () => {
    expect(getFieldValue(subject, field({ id: "genre" }), 1)).toBeUndefined();
  });
});

describe("buildPatchForField", () => {
  it("patches the title column for position 0", () => {
    expect(buildPatchForField(field({ id: "name" }), 0, "Chrono Trigger")).toEqual({
      title: "Chrono Trigger",
    });
  });

  it("coerces a missing title to an empty string rather than null", () => {
    // The column is non-null, so clearing the input has to send "".
    expect(buildPatchForField(field({ id: "name" }), 0, null)).toEqual({ title: "" });
  });

  it.each([
    [true, true],
    [false, false],
    ["", false],
    [0, false],
    ["yes", true],
  ])("coerces a verified value of %j to %j", (value, expected) => {
    expect(buildPatchForField(field({ id: "verified" }), 1, value)).toEqual({ verified: expected });
  });

  it.each([
    ["Alex", "Alex"],
    ["", null],
    [null, null],
  ])("maps a borrower of %j to %j", (value, expected) => {
    // Clearing the borrower has to write null, not "": the lent-out index is a
    // partial index on `borrower is not null`.
    expect(buildPatchForField(field({ id: "borrower" }), 1, value)).toEqual({ borrower: expected });
  });

  it.each([
    ["Boxed copy.", "Boxed copy."],
    ["", null],
    [null, null],
  ])("maps a comments value of %j onto notes as %j", (value, expected) => {
    expect(buildPatchForField(field({ id: "comments" }), 1, value)).toEqual({ notes: expected });
  });

  it("puts anything else in the values bag under its field id", () => {
    expect(buildPatchForField(field({ id: "console" }), 1, "SNES")).toEqual({
      values: { console: "SNES" },
    });
  });

  it("keeps a null values-bag entry, which is how a key gets deleted", () => {
    expect(buildPatchForField(field({ id: "console" }), 1, null)).toEqual({
      values: { console: null },
    });
  });
});
