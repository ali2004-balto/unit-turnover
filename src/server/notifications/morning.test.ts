import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSettings, notifications } from "@/db/schema";
import { getSettings } from "@/db/settings";
import type { Digest } from "@/domain/notifications/reminders";
import { createTestDb, type TestDb } from "@/test/db";
import { createTurnover, runCommand } from "../workflow";
import { morningIsDue, runMorning } from "./morning";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await t.db.update(appSettings).set({ timezone: "Etc/GMT+8" });
});
afterEach(async () => {
  await t.handle.close();
});

/** A local time in the test's fixed UTC-8 zone. */
const local = (date: string, time: string) => new Date(`${date}T${time}:00-08:00`);

async function newAcadian203(createdOn: string) {
  const result = await createTurnover(
    t.db,
    { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: createdOn },
    { actor: t.as(t.ids.admin), now: local(createdOn, "09:00") },
  );
  return result.turnover;
}

async function message(kind: string, day: string, personId: string) {
  const [row] = await t.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.kind, kind), eq(notifications.dedupeKey, `${kind}:${day}:${personId}`)));
  return row;
}

describe("when the morning messages are written", () => {
  const settings = { timezone: "Etc/GMT+8", digestTime: "07:00", quietHoursStart: "20:00", quietHoursEnd: "07:00", lastMorningRunOn: null };

  it("waits for the morning time, outside quiet hours, once a day", () => {
    expect(morningIsDue(local("2026-11-11", "06:59"), settings)).toBe(false);
    expect(morningIsDue(local("2026-11-11", "07:00"), settings)).toBe(true);
    // A server that was off all morning still sends them in the afternoon...
    expect(morningIsDue(local("2026-11-11", "15:30"), settings)).toBe(true);
    // ...but not in the evening, when they'd only be held until tomorrow.
    expect(morningIsDue(local("2026-11-11", "20:30"), settings)).toBe(false);
    expect(morningIsDue(local("2026-11-11", "08:00"), { ...settings, lastMorningRunOn: "2026-11-11" })).toBe(false);
    // A morning time inside quiet hours waits for them to end.
    expect(morningIsDue(local("2026-11-11", "06:30"), { ...settings, digestTime: "06:00" })).toBe(false);
  });
});

describe("the morning run", () => {
  it("queues the inspector's reminder and the manager's summary, once", async () => {
    await newAcadian203("2026-11-09"); // inspection due Wed Nov 11
    expect(await runMorning(t.db, local("2026-11-11", "06:59"))).toEqual({ ran: false, queued: 0 });
    expect(await runMorning(t.db, local("2026-11-11", "07:00"))).toEqual({ ran: true, queued: 2 });
    expect(await runMorning(t.db, local("2026-11-11", "07:05"))).toEqual({ ran: false, queued: 0 });
    expect((await getSettings(t.db)).lastMorningRunOn).toBe("2026-11-11");

    const reminder = await message("daily_tasks", "2026-11-11", t.ids.inspector);
    expect(reminder.data).toEqual({
      day: "2026-11-11",
      items: [expect.objectContaining({ type: "due", unit: "Acadian 203", stepName: "Inspection" })],
    });
    const summary = await message("daily_digest", "2026-11-11", t.ids.admin);
    expect(summary.data).toMatchObject({ day: "2026-11-11", counts: { active: 1 }, urgent: false });
  });

  it("counts anything done on a step as an update", async () => {
    const turnover = await newAcadian203("2026-11-02"); // inspection: alert after 3 quiet days
    await runCommand(
      t.db,
      turnover.id,
      { type: "addNote", stepId: turnover.steps[0].id, text: "Waiting on keys from the tenant" },
      { actor: t.as(t.ids.inspector), now: local("2026-11-04", "10:00") },
    );
    const attention = async (day: string) => {
      await runMorning(t.db, local(day, "07:00"));
      return ((await message("daily_digest", day, t.ids.admin)).data as unknown as Digest).attention;
    };
    expect(await attention("2026-11-06")).toEqual([]); // only Thursday was quiet
    expect(await attention("2026-11-08")).toEqual([
      expect.objectContaining({ type: "stalled", unit: "Acadian 203", stepName: "Inspection", since: "2026-11-04" }),
    ]);
  });
});
