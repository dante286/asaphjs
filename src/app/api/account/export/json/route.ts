import { exportAllJsonAction } from "@/actions/account";

export async function GET() {
  const json = await exportAllJsonAction();
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="asaph-export.json"',
    },
  });
}
