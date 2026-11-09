import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DbHandle, migrateDatabase, openPglite } from "@/db/client";
import { notifications } from "@/db/schema";
import { derive } from "@/domain/derived";
import { parseMasterTrackerCsv, sheetRowToDerivedInput } from "@/import/master-tracker";
import { listTurnovers, type TurnoverList } from "@/server/queries/turnovers";
import { DEMO_UNITS, seedDemo } from "./demo";

const TODAY = "2026-11-09";
const sheet = parseMasterTrackerCsv(
  readFileSync(new URL("../../../data/import/master-tracker-2026-11-09.csv", import.meta.url), "utf8"),
);

let handle: DbHandle;
let list: TurnoverList;
beforeAll(async () => {
  handle = await openPglite(null);
  await migrateDatabase(handle);
  await seedDemo(handle.db, { today: TODAY });
  list = await listTurnovers(handle.db, { today: TODAY });
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const find = (property: string, unit: string) =>
  list.rows.find((r) => r.propertyName === property && r.turnover.unit === unit)!;

describe("demo data", () => {
  it("has your 17 units, 3 Oakwood examples, and a history of finished turns", () => {
    expect(list.rows).toHaveLength(DEMO_UNITS.length);
    expect(DEMO_UNITS.filter((u) => u.fromSheet)).toHaveLength(17);
  });

  it.each(sheet.rows.map((r) => [`${r.property} ${r.unit}`, r] as const))(
    "%s has the same step statuses and current stage as your sheet",
    (_label, sheetRow) => {
      const demo = find(sheetRow.property, sheetRow.unit);
      expect(demo.turnover.steps.map((s) => s.status)).toEqual(sheetRow.steps.map((s) => s.status ?? "not_started"));
      expect(demo.derived.currentStage).toBe(derive(sheetRowToDerivedInput(sheetRow), TODAY, 3).currentStage);
    },
  );

  it("shows every flag somewhere on the board", () => {
    expect(find("WR", "315").derived.flag).toBe("Overdue");
    expect(find("Acadian", "203").derived.flag).toBe("Due soon");
    expect(find("Grandview", "105").derived.flag).toBe("On track");
    expect(find("Rivergate", "305").derived.flag).toBe("No target date");
    expect(find("Courts", "26").derived.flag).toBe("Complete");
    const blocked = find("Oakwood", "101");
    expect(blocked.derived.flag).toBe("Blocked");
    expect(blocked.pastTarget).toBe(true);
  });

  it("includes an N/A skip and a send-back", () => {
    expect(find("Oakwood", "204").turnover.steps.find((s) => s.key === "work")!.status).toBe("na");
    const sentBack = find("Oakwood", "310").turnover.steps.find((s) => s.key === "work")!;
    expect(sentBack).toMatchObject({ status: "in_progress", reworkCount: 1 });
  });

  it("writes Balwin's bookings the way your note does", () => {
    const balwin = find("Balwin", "1").turnover;
    expect(balwin.notes).toBe("Cleaning scheduled Sun Nov 8; photos scheduled Sat Nov 14");
    expect(balwin.steps.find((s) => s.key === "photos")!.scheduledOn).toBe("2026-11-14");
  });

  it("doesn't queue any messages", async () => {
    expect(await handle.db.select().from(notifications)).toEqual([]);
  });
});
