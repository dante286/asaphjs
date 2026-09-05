import { expect, test } from "@playwright/test";
import { addItem, createCollection, openItem, signUp, unique } from "./helpers";

/**
 * The end-to-end form of the constraint the whole test strategy is built on: a
 * deployment with no provider credentials is a supported deployment, not a
 * degraded one. `resolveLookupConfig` returns null, both the create dialog and
 * the detail page render without a lookup panel, and everything else still
 * works.
 *
 * `resolveLookupConfig` has unit tests that stub the environment in both
 * directions. What they can't check is that the two components branch on the
 * value it returns — a panel rendered unconditionally would pass every one of
 * them and then throw on a search against a provider with no keys.
 *
 * Video Games resolves to IGDB, which has no credentials in this environment.
 * Books, Comics, Manga and Strategy Guides would resolve to Open Library, which
 * needs no key and is therefore always configured — those templates render a
 * live panel and one click would send CI at openlibrary.org.
 */

test("a collection whose provider has no keys shows no lookup panel", async ({ page }) => {
  await signUp(page);
  const collectionPath = await createCollection(page, {
    name: unique("Lookup Smoke"),
    template: "Video Games",
  });

  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The dialog's entry point is "Find on <provider>", so the absence of any
  // button with that shape covers a provider being named that shouldn't be.
  await expect(dialog.getByRole("button", { name: /^Find on / })).toHaveCount(0);

  // Close it the way the dialog itself offers, then add the item for real —
  // creation working without a provider is the other half of the claim.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await addItem(page, { title: "Radiant Silvergun" });
  await openItem(page, "Radiant Silvergun");

  await expect(page.getByRole("button", { name: /^Find on / })).toHaveCount(0);
  // The panel's own header, in case the button ever moves behind a disclosure.
  await expect(page.getByText("Metadata", { exact: true })).toHaveCount(0);

  // The row is really in the database, not just in the client cache the dialog
  // wrote to: this list is server-rendered on a fresh request.
  await page.goto(collectionPath);
  await expect(page.getByText("Radiant Silvergun", { exact: true })).toBeVisible();
});
