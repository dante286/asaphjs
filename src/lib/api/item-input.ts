import { z } from "zod";

/**
 * Field-level limits shared by item create (POST) and update (PATCH), so the two
 * can't drift into accepting different things. Generous for real use: a title,
 * a borrower's name, a long notes field, a few hundred custom fields.
 */
export const ITEM_BODY_MAX_BYTES = 256 * 1024;

export const itemTitle = z.string().max(1000);
export const itemBorrower = z.string().max(1000).nullable();
export const itemNotes = z.string().max(50_000).nullable();
export const itemValues = z.record(z.string().min(1).max(200), z.unknown());
