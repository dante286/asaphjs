import { exportAllCsvAction } from "@/actions/account";

export async function GET() {
  const csv = await exportAllCsvAction();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="asaph-export.csv"',
    },
  });
}
