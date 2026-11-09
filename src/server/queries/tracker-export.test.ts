import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import { seedDemo } from "@/db/seed/demo";
import { parseMasterTrackerCsv } from "@/import/master-tracker";
import { toCsv } from "@/lib/csv";
import { createEmptyDb } from "@/test/db";
import { runCommand } from "../workflow";
import { newSheetLink, removeSheetLink, sheetLinkMatches, trackerTable } from "./tracker-export";
import { listTurnovers, type TurnoverList } from "./turnovers";

const TODAY = "2026-11-09";
let handle: DbHandle;
let list: TurnoverList;

beforeAll(async () => {
  handle = await createEmptyDb();
  const { peopleIds, turnoverIds } = await seedDemo(handle.db, { today: TODAY });
  // A note that looks like a formula, to check it can't run when the file is opened.
  const id = turnoverIds.get("Acadian 203")!;
  await runCommand(handle.db, id, { type: "updateTurnover", notes: "=HYPERLINK(\"http://evil.example\")" }, { actor: { personId: peopleIds.get("manager")!, roles: ["admin"] } });
  list = await listTurnovers(handle.db, { today: TODAY });
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const snapshotRows = () =>
  Papa.parse<string[]>(readFileSync(path.join(process.cwd(), "data/import/master-tracker-2026-11-09.csv"), "utf8")).data;

describe("the Master Tracker export", () => {
  it("is laid out exactly like the sheet's Master Tracker tab", () => {
    const table = trackerTable(list, "Nov 9, 2026");
    const sheet = snapshotRows();
    expect(table[0][0]).toBe(sheet[0][0]);
    expect(table[1]).toEqual(sheet[1]);
    expect(table[2]).toEqual(sheet[2]);
    expect(table.slice(3)).toHaveLength(list.rows.length);
    expect(table.every((row) => row.length === 23)).toBe(true);
  });

  it("reads back in with the same units, statuses, dates, scope and calculated columns", () => {
    const parsed = parseMasterTrackerCsv(toCsv(trackerTable(list, "Nov 9, 2026")));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(list.rows.length);
    for (const [i, row] of parsed.rows.entries()) {
      const { turnover: t, derived, propertyName } = list.rows[i];
      expect([row.property, row.unit, row.moveOutDate, row.targetReadyDate]).toEqual([propertyName, t.unit, t.moveOutDate, t.targetReadyDate]);
      expect(row.steps.map((s) => s.status)).toEqual(t.steps.map((s) => s.status));
      expect(row.sheetComputed).toEqual({ currentStage: derived.currentStage, daysVacant: derived.daysVacant, daysInStage: derived.daysInStage, flag: derived.flag });
    }
    const parkdale = parsed.rows.find((r) => r.property === "Parkdale" && r.unit === "405")!;
    expect(parkdale.scopeOfWork).toContain("Sand and repaint vanity cupboards (to confirm)");
    expect(parkdale.steps.find((s) => s.key === "photos")).toMatchObject({ status: "scheduled", date: "2026-11-10" });
    expect(parkdale.assignedTo).toBe("Crew B");
  });

  it("puts blockers in the notes column, and keeps typed formulas from running", () => {
    const table = trackerTable(list, "Nov 9, 2026");
    const oakwood = table.find((r) => r[0] === "Oakwood" && r[1] === "101")!;
    expect(oakwood[22]).toContain("Blocked at In-house work: Waiting on the replacement fridge");
    const csv = toCsv(table);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")`);
    expect(parseMasterTrackerCsv(csv).rows.find((r) => r.unit === "203")!.notes).toBe('=HYPERLINK("http://evil.example")');
  });
});

describe("the live link", () => {
  it("works only with its current secret, and can be replaced or turned off", async () => {
    expect(await sheetLinkMatches(handle.db, "anything")).toBe(false);
    const first = await newSheetLink(handle.db);
    expect(first).toMatch(/^[\w-]{32}$/);
    expect(await sheetLinkMatches(handle.db, first)).toBe(true);
    const second = await newSheetLink(handle.db);
    expect(await sheetLinkMatches(handle.db, first)).toBe(false);
    expect(await sheetLinkMatches(handle.db, second)).toBe(true);
    await removeSheetLink(handle.db);
    expect(await sheetLinkMatches(handle.db, second)).toBe(false);
  });
});
