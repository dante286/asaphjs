import { expect, test } from "@playwright/test";
import { addItem, createCollection, openItem, signUp, unique } from "./helpers";

/**
 * `stripItemsForPublic` has a unit test. This proves it is actually applied on
 * the path a stranger reaches — a share page that forgot to call it would pass
 * that unit test and leak every borrower name in the collection.
 *
 * Both strings are plain ASCII on purpose. An apostrophe or an em dash comes
 * back HTML-escaped, and `not.toContain` on an escaped needle is a test that
 * passes for the wrong reason.
 */
const BORROWER = "Wilhelmina Borrowsworth";
const NOTES = "Kept in the blue crate, spine cracked, missing the manual";

test("a public share link hides borrower and notes from a stranger", async ({ page, browser }) => {
  const name = unique("Share Smoke");

  await signUp(page);
  // Table view rather than covers, and that matters here: TableView is a Client
  // Component, so the rows it receives are serialized into the RSC payload
  // whether or not a given column is on screen. Asserting against the page
  // source therefore proves the two values were never sent, not merely that
  // nothing painted them.
  const collectionPath = await createCollection(page, {
    name,
    template: "Video Games",
    tableView: true,
  });
  await addItem(page, { title: "Panzer Dragoon Saga", borrower: BORROWER, notes: NOTES });

  await page.goto("/account");

  // Two cards carry this collection's name on /account — the settings one and
  // the sharing one. The checkbox label is what tells them apart.
  const sharing = page.locator(".blueprint").filter({ hasText: "Public link" });
  await sharing.getByRole("checkbox", { name: "Public link" }).check();

  // togglePublicLinkAction mints the token server-side and refreshes, so the
  // address arrives as a new prop rather than being knowable before the click.
  const shareUrl = await sharing.getByText(/\/s\/[A-Za-z0-9_-]{10,}$/).innerText();

  // A context of its own: no session cookie, nothing carried over from the
  // owner's browser. Signed out is the only state this page is ever seen in.
  const stranger = await browser.newContext();
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(shareUrl);

    await expect(strangerPage.getByRole("heading", { name })).toBeVisible();

    const html = await strangerPage.content();
    // The title is asserted present first: without it, an empty page or a 404
    // would satisfy both redaction checks below.
    expect(html).toContain("Panzer Dragoon Saga");
    expect(html).not.toContain(BORROWER);
    expect(html).not.toContain(NOTES);
  } finally {
    await stranger.close();
  }

  // And the owner still sees both, so the assertions above are about the public
  // view rather than about the values never having been saved.
  await page.goto(collectionPath);
  await openItem(page, "Panzer Dragoon Saga");
  await expect(page.getByPlaceholder("Nobody — in your possession")).toHaveValue(BORROWER);
});
