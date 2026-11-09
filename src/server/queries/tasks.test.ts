import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DbHandle, migrateDatabase, openPglite } from "@/db/client";
import { properties } from "@/db/schema";
import { type DemoResult, seedDemo } from "@/db/seed/demo";
import { loadTurnover } from "../turnover-store";
import { getTaskDetail, listMyTasks } from "./tasks";

const NOW = new Date("2026-11-09T18:00:00Z");
let handle: DbHandle;
let demo: DemoResult;
beforeAll(async () => {
  handle = await openPglite(null);
  await migrateDatabase(handle);
  demo = await seedDemo(handle.db, { today: "2026-11-09" });
  await handle.db.update(properties).set({ accessNotes: "Lockbox 4471 by the side door" }).where(eq(properties.name, "Balwin"));
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const person = (key: string) => demo.peopleIds.get(key)!;
const label = (t: { propertyName: string; unit: string; stepName: string }) => `${t.propertyName} ${t.unit} · ${t.stepName}`;

describe("my tasks", () => {
  it("lists only the steps that are this person's turn now", async () => {
    const { active, upcoming } = await listMyTasks(handle.db, person("inspector"), NOW);
    expect(active.map(label).sort()).toEqual(["Rivergate 303 · Inspection", "Rivergate 305 · Inspection"]);
    expect(upcoming).toEqual([]);
  });

  it("puts what's pressing first: blocked, then late or a missed booking", async () => {
    const { active } = await listMyTasks(handle.db, person("crewB"), NOW);
    expect(active.map(label)[0]).toBe("Oakwood 101 · In-house work"); // blocked
    const { active: cleaning } = await listMyTasks(handle.db, person("cleaner"), NOW);
    expect(cleaning.slice(0, 6).every((t) => t.propertyName === "Balwin" && t.bookingPassed)).toBe(true);
  });

  it("shows bookings made ahead as upcoming, with the date", async () => {
    const { active, upcoming } = await listMyTasks(handle.db, person("photographer"), NOW);
    // Oakwood 310's photos went back to in-house work, so they're waiting again and not listed.
    expect(active.map(label)).toEqual(["Parkdale 405 · Photos"]);
    expect(upcoming.map((t) => [label(t), t.scheduledOn])).toEqual(
      ["1", "2", "3", "4", "5", "6"].map((u) => [`Balwin ${u} · Photos`, "2026-11-14"]),
    );
  });
});

describe("a task's page", () => {
  it("is only available to the person it's assigned to", async () => {
    const t = await loadTurnover(handle.db, demo.turnoverIds.get("Rivergate 303")!);
    const inspection = t!.steps[0].id;
    expect(await getTaskDetail(handle.db, person("inspector"), inspection, NOW)).not.toBeNull();
    expect(await getTaskDetail(handle.db, person("cleaner"), inspection, NOW)).toBeNull();
    // A step that isn't anyone's turn yet and isn't booked stays hidden, even from its assignee.
    expect(await getTaskDetail(handle.db, person("crewC"), t!.steps[2].id, NOW)).toBeNull();
  });

  it("shows access notes only when it's their turn", async () => {
    const balwin = await loadTurnover(handle.db, demo.turnoverIds.get("Balwin 1")!);
    const cleaning = await getTaskDetail(handle.db, person("cleaner"), balwin!.steps[3].id, NOW);
    expect(cleaning).toMatchObject({ summary: { state: "active" }, property: { accessNotes: "Lockbox 4471 by the side door" } });
    const photos = await getTaskDetail(handle.db, person("photographer"), balwin!.steps[4].id, NOW);
    expect(photos).toMatchObject({ summary: { state: "upcoming", scheduledOn: "2026-11-14" }, property: { accessNotes: null }, attachments: [] });
  });

  it("offers the earlier finished steps for a send-back", async () => {
    const parkdale = await loadTurnover(handle.db, demo.turnoverIds.get("Parkdale 405")!);
    const photos = await getTaskDetail(handle.db, person("photographer"), parkdale!.steps[4].id, NOW);
    expect(photos!.sendBackTargets.map((s) => s.name)).toEqual(["Inspection", "Scope of work", "In-house work", "Cleaning"]);
  });
});
