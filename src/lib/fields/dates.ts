/**
 * Recognises the date spellings a spreadsheet export actually uses and returns
 * them as `YYYY-MM-DD`, the one format `<input type="date">` accepts. Anything
 * else is `null`.
 *
 * Deliberately not `Date.parse`. V8's parser is lenient enough to read
 * "Halo 2", "Volume 3" and "Disc 1" as dates, which turned title-like CSV
 * columns into date fields. Every form here needs a four-digit year and a day
 * that exists in its month.
 *
 * Accepted:
 * - `2021-03-14`, optionally followed by a time (`2021-03-14T10:00:00Z`)
 * - `2021/03/14`, `2021.03.14`
 * - `03/14/2021`, `14/03/2021`, also with `-` or `.`. Month first, as US
 *   exports write it, unless the first number can't be a month (> 12), in
 *   which case it's read day first.
 * - `March 14, 2021`, `Mar 14 2021`, `14 March 2021`, `14 Mar 2021`
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** 1-12 for a full month name or its three-letter abbreviation ("Sept" too); not "Marching". */
function monthIndex(name: string): number | null {
  const lower = name.toLowerCase();
  const index = MONTHS.findIndex((full) => lower === full || lower === full.slice(0, 3));
  if (index !== -1) return index + 1;
  return lower === "sept" ? 9 : null;
}

function build(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function toIsoDate(raw: string): string | null {
  const v = raw.trim();
  let m: RegExpMatchArray | null;

  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/))) {
    return build(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  if ((m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    const [a, b, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return a > 12 ? build(year, b, a) : build(year, a, b);
  }

  if ((m = v.match(/^([A-Za-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/))) {
    const month = monthIndex(m[1]);
    return month ? build(Number(m[3]), month, Number(m[2])) : null;
  }

  if ((m = v.match(/^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+)\.?,? (\d{4})$/))) {
    const month = monthIndex(m[2]);
    return month ? build(Number(m[3]), month, Number(m[1])) : null;
  }

  return null;
}
