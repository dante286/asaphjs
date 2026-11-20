import { describe, expect, it } from "vitest";
import { toIsoDate } from "./dates";

describe("toIsoDate", () => {
  it("passes ISO dates through, dropping a time", () => {
    expect(toIsoDate("2021-03-14")).toBe("2021-03-14");
    expect(toIsoDate("2021-3-4")).toBe("2021-03-04");
    expect(toIsoDate("2021-03-14T10:00:00Z")).toBe("2021-03-14");
    expect(toIsoDate("2021/03/14")).toBe("2021-03-14");
  });

  it("reads slashed dates month first, unless the first number can't be a month", () => {
    expect(toIsoDate("03/14/2021")).toBe("2021-03-14");
    expect(toIsoDate("04/05/2021")).toBe("2021-04-05");
    expect(toIsoDate("14/03/2021")).toBe("2021-03-14");
    expect(toIsoDate("14.03.2021")).toBe("2021-03-14");
  });

  it("reads month names either way round", () => {
    expect(toIsoDate("March 14, 2021")).toBe("2021-03-14");
    expect(toIsoDate("Mar 14 2021")).toBe("2021-03-14");
    expect(toIsoDate("14 March 2021")).toBe("2021-03-14");
    expect(toIsoDate("1st Sept 2021")).toBe("2021-09-01");
  });

  it("refuses the titles V8's Date.parse accepts", () => {
    // The reason this exists: each of these parses with Date.parse.
    for (const title of ["Halo 2", "Volume 3", "Disc 1", "Final Fantasy 7", "Marching 4 2021"]) {
      expect(toIsoDate(title)).toBeNull();
    }
  });

  it("refuses a day that isn't in its month", () => {
    expect(toIsoDate("2021-02-30")).toBeNull();
    expect(toIsoDate("2021-13-01")).toBeNull();
    expect(toIsoDate("02/29/2021")).toBeNull();
    expect(toIsoDate("02/29/2024")).toBe("2024-02-29");
  });

  it("refuses bare numbers and two-digit years", () => {
    expect(toIsoDate("1994")).toBeNull();
    expect(toIsoDate("3/14/21")).toBeNull();
    expect(toIsoDate("")).toBeNull();
  });
});
