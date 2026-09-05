import { describe, expect, it } from "vitest";
import { cloneTemplateFields } from "./templates";
import { field } from "@/test/factories";

const template = () => [
  field({ id: "title", label: "Title", order: 0 }),
  field({ id: "condition", label: "Condition", type: "select", order: 1, options: ["Mint", "Good"] }),
];

describe("cloneTemplateFields", () => {
  it("copies every field through unchanged", () => {
    expect(cloneTemplateFields(template())).toEqual(template());
  });

  it("returns a new array", () => {
    const source = template();

    expect(cloneTemplateFields(source)).not.toBe(source);
  });

  it("gives each field its own object, so renaming a column doesn't touch the template", () => {
    // System template rows are shared by every collection created from them,
    // which is what makes this matter.
    const source = template();
    const cloned = cloneTemplateFields(source);

    cloned[1].label = "Grade";

    expect(cloned[1]).not.toBe(source[1]);
    expect(source[1].label).toBe("Condition");
  });

  it("copes with a template that has no fields", () => {
    expect(cloneTemplateFields([])).toEqual([]);
  });

  it("gives a select its own options array", () => {
    const source = template();
    const cloned = cloneTemplateFields(source);

    cloned[1].options?.push("Poor");

    expect(source[1].options).toEqual(["Mint", "Good"]);
  });
});
