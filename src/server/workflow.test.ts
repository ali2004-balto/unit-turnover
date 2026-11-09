import { asc, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { events, notifications, processedRequests, turnovers } from "@/db/schema";
import { WorkflowError } from "@/domain/workflow/errors";
import { createTestDb, type TestDb } from "@/test/db";
import { loadTurnover } from "./turnover-store";
import { createTurnover, runCommand } from "./workflow";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.handle.close();
});

const NOV_9 = new Date("2026-11-09T17:00:00Z"); // 9am Pacific

async function newAcadian203() {
  const result = await createTurnover(
    t.db,
    { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: "2026-11-02" },
    { actor: t.as(t.ids.admin), now: NOV_9 },
  );
  return result.turnover.id;
}

async function pending() {
  return t.db
    .select({ to: notifications.recipientId, kind: notifications.kind })
    .from(notifications)
    .where(eq(notifications.status, "pending"))
    .orderBy(asc(notifications.createdAt));
}

describe("creating a turnover in the database", () => {
  it("saves the turnover, its six steps with the property's default people, and queues the inspector's text", async () => {
    const id = await newAcadian203();
    const saved = await loadTurnover(t.db, id);
    expect(saved).toMatchObject({ unit: "203", moveOutDate: "2026-11-02", targetReadyDate: "2026-11-12", version: 1 });
    expect(saved!.steps.map((s) => [s.key, s.assigneeId, s.status])).toEqual([
      ["inspection", t.ids.inspector, "not_started"],
      ["scope", t.ids.admin, "not_started"],
      ["work", t.ids.crew, "not_started"],
      ["cleaning", t.ids.cleaner, "not_started"],
      ["photos", t.ids.photographer, "not_started"],
      ["leasing", t.ids.leasing, "not_started"],
    ]);
    expect(saved!.steps[0].activatedAt).toEqual(NOV_9);
    expect(saved!.steps[3].checklist.map((c) => c.text)).toContain("Floors");
    expect(await pending()).toEqual([{ to: t.ids.inspector, kind: "step_assigned" }]);
    const timeline = await t.db.select().from(events).where(eq(events.turnoverId, id)).orderBy(asc(events.id));
    expect(timeline.map((e) => e.type)).toEqual(["turnover_created", "step_activated"]);
  });

  it("lets a manager override the default people", async () => {
    const result = await createTurnover(
      t.db,
      {
        propertyId: t.propertyIds.get("Acadian")!,
        unit: "204",
        moveOutDate: null,
        assignees: { work: t.ids.crew2 },
      },
      { actor: t.as(t.ids.admin), now: NOV_9 },
    );
    expect(result.turnover.steps.find((s) => s.key === "work")!.assigneeId).toBe(t.ids.crew2);
  });

  it("works out 'today' in the business time zone", async () => {
    // 10:30 pm on Nov 9 in Vancouver is already Nov 10 in UTC.
    const lateEvening = new Date("2026-11-10T06:30:00Z");
    const id = await newAcadian203();
    const s = await loadTurnover(t.db, id);
    await runCommand(t.db, id, { type: "complete", stepId: s!.steps[0].id }, { actor: t.as(t.ids.inspector), now: lateEvening });
    expect((await loadTurnover(t.db, id))!.steps[0].completedOn).toBe("2026-11-09");
  });
});

describe("running commands", () => {
  it("saves the handoff, the timeline and the next person's notification together", async () => {
    const id = await newAcadian203();
    const s = (await loadTurnover(t.db, id))!;
    await runCommand(t.db, id, { type: "complete", stepId: s.steps[0].id }, { actor: t.as(t.ids.inspector), now: NOV_9 });
    const after = (await loadTurnover(t.db, id))!;
    expect(after.version).toBe(2);
    expect(after.steps[0]).toMatchObject({ status: "done", completedOn: "2026-11-09" });
    expect(after.steps[1].activatedAt).not.toBeNull();
    expect(await pending()).toEqual([
      { to: t.ids.inspector, kind: "step_assigned" },
      { to: t.ids.admin, kind: "step_assigned" },
    ]);
  });

  it("saves nothing when a rule is broken", async () => {
    const id = await newAcadian203();
    const s = (await loadTurnover(t.db, id))!;
    const [{ n: eventsBefore }] = await t.db.select({ n: count() }).from(events);
    await expect(
      runCommand(t.db, id, { type: "complete", stepId: s.steps[0].id }, { actor: t.as(t.ids.cleaner), requestId: "tap-1" }),
    ).rejects.toThrow(WorkflowError);
    const [{ n: eventsAfter }] = await t.db.select({ n: count() }).from(events);
    expect(eventsAfter).toBe(eventsBefore);
    expect(await t.db.select().from(processedRequests)).toEqual([]);
    expect((await loadTurnover(t.db, id))!.version).toBe(1);
  });

  it("applies a double-tap only once", async () => {
    const id = await newAcadian203();
    const s = (await loadTurnover(t.db, id))!;
    const command = { type: "block" as const, stepId: s.steps[0].id, reason: "No key at the office" };
    const first = await runCommand(t.db, id, command, { actor: t.as(t.ids.inspector), requestId: "tap-42" });
    const second = await runCommand(t.db, id, command, { actor: t.as(t.ids.inspector), requestId: "tap-42" });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const blocked = await t.db.select().from(events).where(eq(events.type, "step_blocked"));
    expect(blocked).toHaveLength(1);
  });

  it("refuses a change made from an out-of-date screen", async () => {
    const id = await newAcadian203();
    const s = (await loadTurnover(t.db, id))!;
    await runCommand(t.db, id, { type: "start", stepId: s.steps[0].id }, { actor: t.as(t.ids.inspector) });
    await expect(
      runCommand(t.db, id, { type: "updateTurnover", notes: "x" }, { actor: t.as(t.ids.admin), expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("can run without messaging anyone (imports and demo data)", async () => {
    const id = await newAcadian203();
    await t.db.delete(notifications);
    const s = (await loadTurnover(t.db, id))!;
    await runCommand(t.db, id, { type: "complete", stepId: s.steps[0].id }, { actor: t.as(t.ids.inspector), suppressNotifications: true });
    expect(await pending()).toEqual([]);
  });

  it("round-trips scope approval, the work checklist, and a send-back through the database", async () => {
    const id = await newAcadian203();
    const step = async (key: string) => (await loadTurnover(t.db, id))!.steps.find((s) => s.key === key)!;
    const admin = { actor: t.as(t.ids.admin) };
    await runCommand(t.db, id, { type: "complete", stepId: (await step("inspection")).id }, admin);
    for (const text of ["Junk removal", "Touch up paint"]) {
      await runCommand(t.db, id, { type: "addChecklistItem", stepId: (await step("scope")).id, text }, admin);
    }
    await runCommand(t.db, id, { type: "complete", stepId: (await step("scope")).id }, admin);
    const work = await step("work");
    expect(work.checklist.map((c) => [c.text, c.source])).toEqual([
      ["Junk removal", "scope"],
      ["Touch up paint", "scope"],
    ]);
    const crew = { actor: t.as(t.ids.crew) };
    for (const item of work.checklist) {
      await runCommand(t.db, id, { type: "setChecklistItemState", stepId: work.id, itemId: item.id, state: "done" }, crew);
    }
    await runCommand(t.db, id, { type: "complete", stepId: work.id }, crew);
    await runCommand(t.db, id, { type: "complete", stepId: (await step("cleaning")).id }, { actor: t.as(t.ids.cleaner) });
    await runCommand(
      t.db,
      id,
      { type: "sendBack", fromStepId: (await step("photos")).id, toStepId: work.id, reason: "Scuff on bedroom wall" },
      { actor: t.as(t.ids.photographer) },
    );
    const reopened = await step("work");
    expect(reopened).toMatchObject({ status: "not_started", reworkCount: 1 });
    expect(reopened.checklist.map((c) => c.state)).toEqual(["done", "done", "open"]);
    expect((await step("cleaning")).status).toBe("not_started");
    const [row] = await t.db.select().from(turnovers).where(eq(turnovers.id, id));
    expect(row.version).toBeGreaterThan(5);
  });
});
