import { Blueprint } from "@/components/ui/Blueprint";

export function DataExportButtons() {
  return (
    <Blueprint
      style={{
        padding: 18,
        display: "flex",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "center",
        fontSize: 13,
        marginBottom: 26,
      }}
    >
      <span>Export every collection as CSV, or the whole account as JSON including custom field definitions.</span>
      <span style={{ display: "flex", gap: 8 }}>
        <a className="btn btn-secondary" href="/api/account/export/csv">
          Export CSV
        </a>
        <a className="btn btn-secondary" href="/api/account/export/json">
          Export JSON
        </a>
      </span>
    </Blueprint>
  );
}
