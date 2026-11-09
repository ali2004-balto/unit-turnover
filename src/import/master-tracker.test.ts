import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { derive } from "@/domain/derived";
import { summarize } from "@/domain/summary";
import {
  parseBookings,
  parseDateCell,
  parseMasterTrackerCsv,
  SHEET_STEP_KEYS,
  SHEET_STEP_NAMES,
  sheetRowToDerivedInput,
  splitScope,
} from "./master-tracker";

const csv = readFileSync(new URL("../../data/import/master-tracker-2026-11-09.csv", import.meta.url), "utf8");
const expected = JSON.parse(
  readFileSync(new URL("../../data/import/master-tracker-2026-11-09.summary.json", import.meta.url), "utf8"),
);
const EXPORTED_ON = expected.exportedOn as string;

describe("Master Tracker CSV import: your real sheet (2026-11-09)", () => {
  const { rows, warnings } = parseMasterTrackerCsv(csv);

  it("reads all 17 unit turns with no warnings", () => {
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(17);
    expect(rows.map((r) => `${r.property} ${r.unit}`)).toEqual([
      "Acadian 203",
      "Parkdale 405",
      "Arbor 201",
      "Pioneer 202B",
      "Courts 26",
      "Rivergate 305",
      "Rivergate 303",
      "WR 315",
      "Balwin 1",
      "Balwin 2",
      "Balwin 3",
      "Balwin 4",
      "Balwin 5",
      "Balwin 6",
      "Grandview 102",
      "Grandview 105",
      "Grandview 302",
    ]);
  });

  it("reads statuses, dates, scope, notes and sheet row numbers", () => {
    const acadian = rows[0];
    expect(acadian.rowNumber).toBe(5);
    expect(acadian.steps.map((s) => s.status)).toEqual(["done", "done", "not_started", "not_started", "not_started", "not_started"]);
    expect(acadian.steps[0].date).toBe("2026-11-06");
    expect(acadian.scopeOfWork).toBe("Junk removal; touch up paint");
    const parkdale = rows[1];
    expect(parkdale.steps[4].status).toBe("scheduled");
    expect(parkdale.notes).toBe("Vanity cupboards sand and repaint to be confirmed. Photos scheduled");
  });

  it.each(parseMasterTrackerCsv(csv).rows.map((r) => [`${r.property} ${r.unit} (row ${r.rowNumber})`, r] as const))(
    "%s: stage, days and flag match the sheet's own formulas",
    (_label, row) => {
      const d = derive(sheetRowToDerivedInput(row), EXPORTED_ON, expected.dueSoonDays);
      expect({
        currentStage: d.currentStage,
        daysVacant: d.daysVacant,
        daysInStage: d.daysInStage,
        flag: d.flag,
      }).toEqual(row.sheetComputed);
    },
  );

  it("produces the same Summary tab numbers", () => {
    const stageLabels = SHEET_STEP_KEYS.map((k, i) => `${i + 1}. ${SHEET_STEP_NAMES[k]}`);
    const summary = summarize(
      rows.map((r) => ({
        derived: derive(sheetRowToDerivedInput(r), EXPORTED_ON, expected.dueSoonDays),
        moveOutDate: r.moveOutDate,
        work: [{ assigneeName: r.assignedTo || null, status: r.steps[2].status }],
      })),
      stageLabels,
      expected.inHouseEmployees,
    );
    const { crew, ...rest } = summary;
    expect(rest).toEqual(expected.summary);
    expect(crew).toEqual([]);
  });
});

describe("parseMasterTrackerCsv", () => {
  it("finds columns by header text even if they move", () => {
    const moved = [
      "Notes / blockers,Unit,Property,Inspection status,Scope status,Work status,Cleaning status,Photos status,Leasing status,Move-out date",
      "Keys at office,12,Oakwood,Done,In progress,,,,,2026-11-01",
    ].join("\n");
    const { rows } = parseMasterTrackerCsv(moved);
    expect(rows[0]).toMatchObject({ property: "Oakwood", unit: "12", notes: "Keys at office", moveOutDate: "2026-11-01" });
    expect(rows[0].steps.map((s) => s.status)).toEqual(["done", "in_progress", null, null, null, null]);
  });

  it("warns about statuses and dates it can't read instead of guessing", () => {
    const csvText = [
      "Property,Unit,Move-out date,Inspection status,Scope status,Work status,Cleaning status,Photos status,Leasing status",
      "Oakwood,12,11/02/2026,Finished,,,,,",
    ].join("\n");
    const { rows, warnings } = parseMasterTrackerCsv(csvText);
    expect(rows[0].moveOutDate).toBeNull();
    expect(rows[0].steps[0].status).toBeNull();
    expect(warnings.map((w) => w.column)).toEqual(["Move-out date", "Inspection status"]);
  });

  it("rejects a file without the Master Tracker header row", () => {
    expect(() => parseMasterTrackerCsv("Headline,Value\nActive turns,16")).toThrow(/header row/);
  });
});

describe("parseDateCell", () => {
  it.each([
    ["", null],
    ["2026-11-06", "2026-11-06"],
    ["2026/11/6", "2026-11-06"],
    ["46332", "2026-11-06"],
    ["Nov 6, 2026", "2026-11-06"],
    ["6 Nov 2026", "2026-11-06"],
    ["6-Nov-2026", "2026-11-06"],
  ])("%j → %j", (text, date) => {
    expect(parseDateCell(text).date).toBe(date);
  });

  it("refuses ambiguous or impossible dates", () => {
    expect(parseDateCell("11/06/2026").error).toBeTruthy();
    expect(parseDateCell("2026-02-30").error).toBeTruthy();
  });
});

describe("splitScope", () => {
  it("splits on semicolons and marks 'to confirm' items (Parkdale 405)", () => {
    const items = splitScope(
      "New light switch covers; touch up paint where required; stain bedroom door; sand and repaint vanity cupboards (to confirm); patio door repair (replace if needed); replace light bulbs (fixtures if needed)",
    );
    expect(items).toEqual([
      { text: "New light switch covers", toConfirm: false },
      { text: "Touch up paint where required", toConfirm: false },
      { text: "Stain bedroom door", toConfirm: false },
      { text: "Sand and repaint vanity cupboards", toConfirm: true },
      { text: "Patio door repair (replace if needed)", toConfirm: false },
      { text: "Replace light bulbs (fixtures if needed)", toConfirm: false },
    ]);
  });

  it("falls back to commas when there are no semicolons (WR 315)", () => {
    expect(splitScope("3 doors, 1 drawer, new stove").map((i) => i.text)).toEqual(["3 doors", "1 drawer", "New stove"]);
  });

  it("keeps a single item whole", () => {
    expect(splitScope("Replace 1 window")).toEqual([{ text: "Replace 1 window", toConfirm: false }]);
    expect(splitScope("")).toEqual([]);
  });
});

describe("parseBookings", () => {
  it("reads Balwin's bookings and checks the weekdays", () => {
    expect(parseBookings("Cleaning scheduled Sun Nov 8; photos scheduled Sat Nov 14", "2026-11-09")).toEqual({
      cleaning: { on: "2026-11-08", weekdayMatches: true },
      photos: { on: "2026-11-14", weekdayMatches: true },
    });
  });

  it("ignores notes that mention scheduling without a date", () => {
    expect(parseBookings("Vanity cupboards sand and repaint to be confirmed. Photos scheduled", "2026-11-09")).toEqual({});
    expect(parseBookings("Cleaning and photos not scheduled yet", "2026-11-09")).toEqual({});
  });

  it("picks the nearest year and flags a weekday that doesn't match", () => {
    expect(parseBookings("Photos booked for Fri Jan 2", "2026-12-20")).toEqual({
      photos: { on: "2027-01-02", weekdayMatches: false },
    });
  });
});
