import { describe, expect, it } from "vitest";
import { parseBulk, parseLooseDate } from "./bulk";

const P = [
  { id: "p-acadian", name: "Acadian" },
  { id: "p-balwin", name: "Balwin" },
  { id: "p-parkdale", name: "Parkdale" },
  { id: "p-grandview", name: "Grandview" },
  { id: "p-wr", name: "WR" },
];
const TODAY = "2026-11-09";
const parse = (text: string, opts: Parameters<typeof parseBulk>[2] = { today: TODAY }) => parseBulk(text, P, opts);

describe("parseLooseDate", () => {
  it.each([
    ["2026-11-15", "2026-11-15"],
    ["2026/11/5", "2026-11-05"],
    ["Nov 15", "2026-11-15"],
    ["nov 15 2026", "2026-11-15"],
    ["15 Nov", "2026-11-15"],
    ["November 15, 2026", "2026-11-15"],
    ["Jan 3", "2027-01-03"], // nearest to Nov 9 is next January
    ["Feb 30", null],
    ["soon", null],
  ])("%s → %s", (text, expected) => {
    expect(parseLooseDate(text, TODAY)).toBe(expected);
  });
});

describe("parseBulk", () => {
  it("reads 'Property Unit' lines, with the default move-out", () => {
    expect(parse("Acadian 203\nparkdale 405", { today: TODAY, defaultMoveOut: "2026-11-01" })).toEqual([
      { line: 1, text: "Acadian 203", propertyId: "p-acadian", propertyName: "Acadian", unit: "203", moveOutDate: "2026-11-01" },
      { line: 2, text: "parkdale 405", propertyId: "p-parkdale", propertyName: "Parkdale", unit: "405", moveOutDate: "2026-11-01" },
    ]);
  });

  it("reads move-out and target dates in several shapes", () => {
    const rows = parse("Parkdale, 405, Nov 2, Nov 12\nGrandview\t105\t2026-11-02\nWR 315 2026-10-23 2026-11-02\nAcadian 203 Nov 1 Nov 11");
    expect(rows.map((r) => [r.propertyName, r.unit, r.moveOutDate, r.targetReadyDate])).toEqual([
      ["Parkdale", "405", "2026-11-02", "2026-11-12"],
      ["Grandview", "105", "2026-11-02", undefined],
      ["WR", "315", "2026-10-23", "2026-11-02"],
      ["Acadian", "203", "2026-11-01", "2026-11-11"],
    ]);
    expect(rows.every((r) => !r.error)).toBe(true);
  });

  it("expands a range like Balwin 1-6", () => {
    const rows = parse("Balwin 1-6, 2026-11-03");
    expect(rows.map((r) => r.unit)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(rows.every((r) => r.moveOutDate === "2026-11-03")).toBe(true);
  });

  it("explains every line it can't use", () => {
    const rows = parse("Oakridge 12\nAcadian\nAcadian 203 someday\nBalwin 6-1\nAcadian 204 Nov 12 Nov 2\nAcadian 205\nAcadian 205");
    expect(rows.map((r) => r.error)).toEqual([
      '"Oakridge" isn\'t one of your properties',
      "No unit",
      '"someday" isn\'t a date the list understands (try 2026-11-15 or Nov 15)',
      '"6-1" isn\'t a range from low to high',
      "The target is before the move-out",
      undefined,
      "Listed twice",
    ]);
  });

  it("warns about units that already have a turnover in progress", () => {
    const rows = parse("Acadian 203", { today: TODAY, activeUnits: new Set(["p-acadian|203"]) });
    expect(rows[0]).toMatchObject({ warning: "Already has a turnover in progress" });
  });

  it("skips blank lines, comments and a pasted header row", () => {
    expect(parse("Property\tUnit\tMove-out date\n\n# Balwin building\nBalwin\t1\t2026-11-02")).toHaveLength(1);
  });
});
