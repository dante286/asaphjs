import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/**
 * The four smoke specs share a preamble — sign up, make a collection, add an
 * item — that isn't what any of them is testing. It lives here so a spec reads
 * as its own assertion, and so a change to the create dialog is one edit rather
 * than four.
 *
 * Selectors are the user-facing kind (role, placeholder, visible text) wherever
 * the markup allows it. The exception is the auth form, which is a real `<form>`
 * with real `name` attributes and two password fields sharing one placeholder,
 * so it's addressed by name.
 */

/** Long enough to clear better-auth's `minPasswordLength: 8`. */
const PASSWORD = "e2e-password-1234";

/**
 * Every spec gets a fresh account, and every collection a name nothing else
 * will claim: workers run in parallel against one database, and slugs are unique
 * across the whole table rather than per owner.
 */
export function unique(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

/** Registers a throwaway account and lands signed in on the dashboard. */
export async function signUp(page: Page): Promise<{ email: string; password: string }> {
  const email = `e2e-${randomUUID()}@example.test`;

  await page.goto("/auth");

  // The segmented control's radios are `opacity: 0; pointer-events: none` (see
  // `.seg-opt input` in design-system.css), so the visible label is the only
  // thing anyone — a person or Playwright — can click.
  await page.locator("label.seg-opt", { hasText: "Create account" }).click();
  await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();

  await page.locator('input[name="displayName"]').fill("Smoke Runner");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="confirmPassword"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // signUpAction redirects to "/", which the middleware only lets through once
  // the session cookie is set — so arriving here is the assertion that it is.
  await page.waitForURL("/");
  return { email, password: PASSWORD };
}

/**
 * Creates a collection from a system template and returns its URL.
 *
 * `template` must be one whose provider has no credentials in this environment.
 * Open Library needs no key, so `isProviderConfigured("openlibrary")` is
 * permanently true and a Books, Comics, Manga or Strategy Guides collection
 * renders a live lookup panel — one stray click in a spec and CI is hitting
 * openlibrary.org. "Video Games" resolves to IGDB, which has no keys here.
 */
export async function createCollection(
  page: Page,
  options: { name: string; template: "Video Games"; tableView?: boolean },
): Promise<string> {
  await page.goto("/collections/new");

  // The template cards are the only place this label appears as text — the name
  // field below takes it as an input *value*, which `getByText` doesn't see.
  await page.getByText(options.template, { exact: true }).click();

  await page
    .locator(".field")
    .filter({ hasText: "Collection name" })
    .locator("input")
    .fill(options.name);

  if (options.tableView) {
    await page.getByRole("checkbox", { name: /Default to table view/ }).check();
  }

  await page.getByRole("button", { name: "Create collection" }).click();

  // createCollectionAction redirects to the slug it minted. Not knowable here:
  // it's derived from the name, but a name that collides gets a suffix. Spelled
  // out as "somewhere under /collections that isn't this page" rather than as a
  // pattern, because `/collections/new` matches every pattern for a slug and
  // this would otherwise resolve instantly against the page we're still on.
  await page.waitForURL(
    (url) => url.pathname.startsWith("/collections/") && url.pathname !== "/collections/new",
  );
  return new URL(page.url()).pathname;
}

/** Adds one item through the create dialog and waits for it to reach the list. */
export async function addItem(
  page: Page,
  item: { title: string; borrower?: string; notes?: string },
): Promise<void> {
  await page.getByRole("button", { name: "Add item" }).click();

  // Scoped to the dialog throughout: its submit button and the toolbar button
  // that opened it are both called "Add item".
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("What are you adding?").fill(item.title);
  if (item.borrower !== undefined) {
    await dialog.getByPlaceholder("Nobody — in your possession").fill(item.borrower);
  }
  if (item.notes !== undefined) {
    await dialog.getByPlaceholder(/^Condition, where you bought it/).fill(item.notes);
  }
  await dialog.getByRole("button", { name: "Add item", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(item.title, { exact: true })).toBeVisible();
}

/** Opens an item's detail page from the collection's list, whichever view it's in. */
export async function openItem(page: Page, title: string): Promise<void> {
  await page.getByText(title, { exact: true }).click();
  await page.waitForURL(/\/items\/[^/]+$/);

  // The detail page's title is an editable input rather than a heading, so the
  // cover control is what says the page is there and the session can edit it.
  await expect(page.getByRole("button", { name: /^(Upload a photo|Replace photo)$/ })).toBeVisible();
}
