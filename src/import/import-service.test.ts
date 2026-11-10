import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DbHandle, migrateDatabase, openPglite } from "@/db/client";
import { events, notifications, people } from "@/db/schema";
import { listTurnovers } from "@/server/queries/turnovers";
import { importMasterTracker } from "./import-service";
import { parseMasterTrackerCsv } from "./master-tracker";

const FILE = "master-tracker-2026-11-09.csv";
const csv = readFileSync(new URL(`../../data/import/${FILE}`, import.meta.url), "utf8");
const IMPORTED_AT = new Date("2026-11-09T18:00:00Z");

let handle: DbHandle;
beforeEach(async () => {
  handle = await openPglite(null);
  await migrateDatabase(handle);
});
afterEach(async () => {
  await handle.close();
});

async function importSnapshot(replace = false) {
  return importMasterTracker(handle.db, parseMasterTrackerCsv(csv), {
    file: FILE,
    exportedOn: "2026-11-09",
    now: IMPORTED_AT,
    replace,
  });
}

describe("importing your sheet into the database", () => {
  it("creates all 17 turnovers, and the app's calculated columns match the sheet's", async () => {
    const report = await importSnapshot();
    expect(report).toMatchObject({ created: 17, skipped: [], warnings: [], newProperties: [], newPeople: [] });
    const { rows } = await listTurnovers(handle.db, { today: "2026-11-09" });
    expect(rows).toHaveLength(17);
    for (const row of rows) {
      const { derived, importSource } = row;
      expect({
        currentStage: derived.currentStage,
        daysVacant: derived.daysVacant,
        daysInStage: derived.daysInStage,
        flag: derived.flag,
      }).toEqual(importSource!.sheetComputed);
    }
  });

  it("keeps scope items, 'to confirm' items, notes and bookings written in notes", async () => {
    await importSnapshot();
    const { rows } = await listTurnovers(handle.db, { today: "2026-11-09" });
    const find = (p: string, u: string) => rows.find((r) => r.propertyName === p && r.turnover.unit === u)!.turnover;

    const parkdale = find("Parkdale", "405");
    const work = parkdale.steps.find((s) => s.key === "work")!;
    expect(work.status).toBe("done");
    expect(work.checklist.map((c) => c.state)).toEqual(["done", "done", "done", "to_confirm", "done", "done"]);
    expect(parkdale.notes).toBe("Vanity cupboards sand and repaint to be confirmed. Photos scheduled");
    expect(parkdale.steps[0].completedOn).toBe("2026-11-05");

    const balwin = find("Balwin", "1");
    expect(balwin.steps.find((s) => s.key === "cleaning")).toMatchObject({ status: "scheduled", scheduledOn: "2026-11-08" });
    expect(balwin.steps.find((s) => s.key === "photos")).toMatchObject({ status: "scheduled", scheduledOn: "2026-11-14" });

    const wr = find("WR", "315");
    expect(wr.steps.find((s) => s.key === "scope")!.checklist.map((c) => c.text)).toEqual(["3 doors", "1 drawer", "New stove"]);
    expect(wr.steps.find((s) => s.key === "work")!.checklist.map((c) => c.state)).toEqual(["open", "open", "open"]);
  });

  it("messages nobody and records where each row came from", async () => {
    await importSnapshot();
    expect(await handle.db.select().from(notifications)).toEqual([]);
    const imported = await handle.db.select().from(events).where(eq(events.type, "imported"));
    expect(imported).toHaveLength(17);
    expect(imported[0].data).toMatchObject({ file: FILE });
  });

  it("skips units already imported, and can replace everything on request", async () => {
    await importSnapshot();
    const again = await importSnapshot();
    expect(again.created).toBe(0);
    expect(again.skipped).toHaveLength(17);
    const replaced = await importSnapshot(true);
    expect(replaced.created).toBe(17);
    expect((await listTurnovers(handle.db)).rows).toHaveLength(17);
  });

  it("previews an import exactly, without keeping any of it", async () => {
    const preview = await importMasterTracker(handle.db, parseMasterTrackerCsv(csv), {
      file: FILE,
      exportedOn: "2026-11-09",
      now: IMPORTED_AT,
      dryRun: true,
    });
    expect(preview.created).toBe(17);
    expect((await listTurnovers(handle.db)).rows).toHaveLength(0);
    expect(await handle.db.select().from(events)).toEqual([]);
    expect(await importSnapshot()).toEqual(preview);
  });

  it("adds people named in 'Assigned to' as in-house employees", async () => {
    const withName = csv.replace("Junk removal; touch up paint,Not started,,", "Junk removal; touch up paint,Not started,,Sam");
    const report = await importMasterTracker(handle.db, parseMasterTrackerCsv(withName), {
      file: FILE,
      exportedOn: "2026-11-09",
      now: IMPORTED_AT,
    });
    expect(report.newPeople).toEqual(["Sam"]);
    const [sam] = await handle.db.select().from(people).where(eq(people.name, "Sam"));
    expect(sam.roles).toEqual(["crew"]);
    const { rows } = await listTurnovers(handle.db, { today: "2026-11-09" });
    const acadian = rows.find((r) => r.propertyName === "Acadian")!;
    expect(acadian.turnover.steps.find((s) => s.key === "work")!.assigneeId).toBe(sam.id);
  });
});
