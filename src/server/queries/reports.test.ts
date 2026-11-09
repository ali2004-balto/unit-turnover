import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSettings } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";
import { createTurnover, runCommand } from "../workflow";
import { loadReport } from "./reports";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await t.db.update(appSettings).set({ timezone: "Etc/GMT+8" });
});
afterEach(async () => {
  await t.handle.close();
});

/** 9 am local (UTC-8) on a day in November 2026, plus some hours. */
const at = (day: number, hours = 0) => new Date(Date.UTC(2026, 10, day, 17 + hours));

describe("loading a report from the database", () => {
  it("times each step from the timeline and credits send-backs to whose work came back", async () => {
    const { turnover } = await createTurnover(
      t.db,
      { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: "2026-11-01", targetReadyDate: "2026-11-20" },
      { actor: t.as(t.ids.admin), now: at(2) },
    );
    const [inspection, scope, work, cleaning, photos, leasing] = turnover.steps;
    const run = (by: string, when: Date, command: Parameters<typeof runCommand>[2]) => runCommand(t.db, turnover.id, command, { actor: t.as(by), now: when });

    await run(t.ids.inspector, at(3), { type: "complete", stepId: inspection.id }); // 1 day
    await run(t.ids.admin, at(3, 12), { type: "addChecklistItem", stepId: scope.id, text: "Touch up paint" });
    await run(t.ids.admin, at(4), { type: "complete", stepId: scope.id }); // 1 day
    await run(t.ids.admin, at(6), { type: "setChecklistItemState", stepId: work.id, itemId: (await workItem()).id, state: "done" });
    await run(t.ids.crew, at(6), { type: "complete", stepId: work.id }); // 2 days
    await run(t.ids.cleaner, at(7), { type: "complete", stepId: cleaning.id }); // 1 day
    await run(t.ids.photographer, at(8), { type: "sendBack", fromStepId: photos.id, toStepId: work.id, reason: "Scuff on the wall" });
    await run(t.ids.admin, at(9), { type: "complete", stepId: work.id }); // +1 day: 3 in all
    await run(t.ids.cleaner, at(9, 6), { type: "complete", stepId: cleaning.id }); // +0.25 day
    await run(t.ids.photographer, at(10, 6), { type: "complete", stepId: photos.id }); // 1 day before sending it back, 1 after
    await run(t.ids.leasing, at(11, 6), { type: "complete", stepId: leasing.id }); // 1 day

    const { report } = await loadReport(t.db, { period: "30d", today: "2026-11-20" });
    expect(report.steps.map((s) => [s.name, s.avgDays])).toEqual([
      ["Inspection", 1],
      ["Scope of work", 1],
      ["In-house work", 3],
      ["Cleaning", 1.25],
      ["Photos", 2],
      ["Leasing upload", 1],
    ]);
    expect(report.completed).toEqual([
      expect.objectContaining({ label: "Acadian 203", readyOn: "2026-11-11", daysVacant: 10, onTime: true, sendBacks: 1 }),
    ]);
    expect(report.byPerson.find((p) => p.name === "Crew A")).toMatchObject({ sentBack: 1 });
    expect(report.rework).toEqual({ byToStep: [{ step: "In-house work", count: 1 }], byFromStep: [{ step: "Photos", count: 1 }] });

    async function workItem() {
      const { loadTurnover } = await import("../turnover-store");
      return (await loadTurnover(t.db, turnover.id))!.steps[2].checklist[0];
    }
  });

  it("filters to one property", async () => {
    await createTurnover(t.db, { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: "2026-11-01" }, { actor: t.as(t.ids.admin), now: at(2) });
    const { report, properties } = await loadReport(t.db, { period: "all", propertyId: t.propertyIds.get("Balwin")!, today: "2026-11-20" });
    expect(report.byProperty).toEqual([]);
    expect(properties.map((p) => p.name)).toContain("Balwin");
  });
});
