import type { FieldDef } from "@/lib/fields/field-def";
import { toIsoDate } from "@/lib/fields/dates";
import { getFieldValue, parseTags, type ItemLike } from "@/lib/fields/item-values";

// The per-field-type input renderer shared by the table view and the item
// detail page, so checkbox/select/date/number/text behavior can't drift
// between the two places an item's fields are edited.
export function FieldCell({
  item,
  field,
  index,
  disabled,
  onChange,
}: {
  item: ItemLike;
  field: FieldDef;
  index: number;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const value = getFieldValue(item, field, index);

  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        defaultChecked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--color-accent)", width: 16, height: 16 }}
      />
    );
  }

  if (field.type === "select" && field.options?.length) {
    return (
      <select
        className="input"
        defaultValue={String(value ?? "")}
        disabled={disabled}
        // The blank option clears the field rather than storing "".
        onChange={(e) => onChange(e.target.value || null)}
        style={{ border: "1px solid transparent", background: "transparent", fontSize: 13.5, padding: "4px 6px" }}
      >
        <option value="" />
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        // Normalised for display: rows imported before dates were stored as
        // `YYYY-MM-DD` hold "03/14/2021" and the like, which a date input
        // rejects and shows blank.
        defaultValue={value ? (toIsoDate(String(value)) ?? "") : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ border: "1px solid transparent", background: "transparent", font: "inherit", fontSize: 13.5, padding: "4px 6px", color: "inherit" }}
      />
    );
  }

  if (field.type === "number") {
    return (
      <input
        type="number"
        defaultValue={value === null || value === undefined ? "" : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ border: "1px solid transparent", background: "transparent", font: "inherit", fontSize: 13.5, padding: "4px 6px", width: "100%", color: "inherit" }}
      />
    );
  }

  // Tags are stored as an array and edited as comma-separated text, split the
  // same way an import splits them — saving the raw text would turn
  // ["RPG", "Action"] into the string "RPG, Action".
  const isTags = field.type === "tags";
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);

  return (
    <input
      type="text"
      defaultValue={text}
      disabled={disabled}
      onChange={(e) => onChange(isTags ? parseTags(e.target.value) : e.target.value)}
      style={{
        border: "1px solid transparent",
        background: "transparent",
        font: "inherit",
        fontSize: 13.5,
        padding: "4px 6px",
        width: "100%",
        minWidth: field.type === "longtext" ? 220 : 90,
        color: "inherit",
        borderRadius: 0,
      }}
    />
  );
}
