"use server";

import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth/auth";
import { requireSession } from "@/lib/auth/session";
import { listCollectionsForUser } from "@/db/queries/collections";
import { listItems } from "@/db/queries/items";
import { getFieldValue } from "@/lib/fields/item-values";

export type ActionState = { error?: string; ok?: boolean } | undefined;

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();
  const name = String(formData.get("displayName") ?? "").trim();
  const timeZone = String(formData.get("timeZone") ?? "UTC").trim();
  const currency = String(formData.get("currency") ?? "USD").trim();

  try {
    await auth.api.updateUser({
      headers: await headers(),
      body: { name, timeZone, currency },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Couldn't update your profile." };
  }
  return { ok: true };
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");

  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: false },
    });
  } catch (err) {
    if (err instanceof APIError) return { error: err.message };
    return { error: "Couldn't change your password." };
  }
  return { ok: true };
}

export async function signOutEverywhereAction() {
  await requireSession();
  await auth.api.revokeSessions({ headers: await headers() });
}

function toCsvValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportAllCsvAction() {
  const session = await requireSession();
  const collectionRows = await listCollectionsForUser(session.user.id);

  const parts: string[] = [];
  for (const { collection } of collectionRows) {
    const { rows } = await listItems({ collectionId: collection.id, pageSize: 10000 });
    const fields = collection.fields;
    parts.push(`# ${collection.name}`);
    parts.push(fields.map((f) => toCsvValue(f.label)).join(","));
    for (const item of rows) {
      const line = fields.map((field, index) => toCsvValue(getFieldValue(item, field, index)));
      parts.push(line.join(","));
    }
    parts.push("");
  }
  return parts.join("\n");
}

export async function exportAllJsonAction() {
  const session = await requireSession();
  const collectionRows = await listCollectionsForUser(session.user.id);

  const data = await Promise.all(
    collectionRows.map(async ({ collection }) => {
      const { rows } = await listItems({ collectionId: collection.id, pageSize: 10000 });
      return {
        name: collection.name,
        templateKey: collection.templateKey,
        fields: collection.fields,
        items: rows,
      };
    }),
  );
  return JSON.stringify(data, null, 2);
}
