/**
 * Cells for the account's CSV export. Kept out of `src/actions/account.ts`,
 * which is a "use server" module and so can export only async functions.
 */

/**
 * Characters that make a spreadsheet treat a cell as a formula (or, for tab and
 * carriage return, that some of them strip before checking for one). Item
 * titles and values come from editors, CSV imports and metadata providers, and
 * a cell like `=HYPERLINK("https://…","click")` or `=WEBSERVICE(…)` runs when
 * the owner opens their own export in Excel or Sheets.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** A plain number, which can start with `-` or `+` and isn't a formula. */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * One cell. A text value that a spreadsheet would read as a formula gets a
 * leading `'`, which spreadsheets show as text rather than running; the OWASP
 * recommendation. The cost is that the apostrophe survives a reimport, which is
 * the right way round for a file whose job is to be opened. Numbers, and text
 * that's just a number, are left alone, so `-5` stays `-5`.
 *
 * Then the usual quoting: any cell with a quote, comma, CR or LF is quoted, with
 * quotes doubled.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && FORMULA_TRIGGER.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The `# Collection name` line that heads each collection's block. A name is
 * free text, so a line break in it would end the line early and start a fake
 * row; line breaks become spaces.
 */
export function csvSectionHeading(name: string): string {
  return `# ${name.replace(/[\r\n]+/g, " ")}`;
}
