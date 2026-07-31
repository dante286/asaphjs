import type { FieldDef } from "@/lib/fields/field-def";
import { getFieldValue, isTitleField } from "@/lib/fields/item-values";
import type { Item } from "@/lib/api/items-client";

export function TableView({
  items,
  fields,
  canEdit,
  onFieldChange,
  onDelete,
  rowCountLabel,
}: {
  items: Item[];
  fields: FieldDef[];
  canEdit: boolean;
  onFieldChange: (item: Item, field: FieldDef, index: number, value: unknown) => void;
  onDelete: (item: Item) => void;
  rowCountLabel: string;
}) {
  const columns = fields
    .map((f, index) => ({ field: f, index }))
    .filter(({ field, index }) => isTitleField(index) || field.showInTable);

  return (
    <div className="blueprint" style={{ padding: "6px 14px 10px", overflowX: "auto" }}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <table className="table" style={{ minWidth: 1080 }}>
        <thead>
          <tr>
            {columns.map(({ field }) => (
              <th key={field.id}>{field.label}</th>
            ))}
            {canEdit && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {columns.map(({ field, index }) => (
                <td key={field.id} style={{ verticalAlign: "middle" }}>
                  <Cell
                    item={item}
                    field={field}
                    index={index}
                    disabled={!canEdit}
                    onChange={(value) => onFieldChange(item, field, index, value)}
                  />
                </td>
              ))}
              {canEdit && (
                <td>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => onDelete(item)} type="button">
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 6px 4px",
          fontSize: 11.5,
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        <span>Every edit saves on change — no Save button, nothing lost to a session timeout.</span>
        <span>{rowCountLabel}</span>
      </div>
    </div>
  );
}

function Cell({
  item,
  field,
  index,
  disabled,
  onChange,
}: {
  item: Item;
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
        onChange={(e) => onChange(e.target.value)}
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
        defaultValue={value ? String(value) : ""}
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

  return (
    <input
      type="text"
      defaultValue={value === null || value === undefined ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
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
