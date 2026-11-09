import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSettings, notifications, people } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";
import { createTurnover } from "../workflow";
import { listOutbox, retryNotification } from "./outbox";
import { dryRunProvider } from "./providers";
import { sendDue } from "./sender";

let t: TestDb;
const MON_9AM = new Date("2026-11-09T17:00:00Z");

beforeEach(async () => {
  t = await createTestDb();
  await t.db.update(appSettings).set({ timezone: "Etc/GMT+8" });
  await t.db.update(people).set({ phone: "+16045550101" }).where(eq(people.id, t.ids.inspector));
  await createTurnover(
    t.db,
    { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: "2026-11-02" },
    { actor: t.as(t.ids.admin), now: MON_9AM },
  );
});
afterEach(async () => {
  await t.handle.close();
});

describe("the outbox", () => {
  it("previews a message before it goes, and shows the words sent after", async () => {
    let page = await listOutbox(t.db, { view: "all", page: 1 });
    expect(page.counts).toEqual({ all: 1, waiting: 1, sent: 0, unsent: 0 });
    expect(page.entries[0]).toMatchObject({ kind: "step_assigned", recipientName: "Inspector", unit: "Acadian 203", status: "pending", isPreview: true });
    expect(page.entries[0].message.sms).toBe("Acadian 203: Inspection is ready for you, due Wed Nov 11. Open: [link]");

    await sendDue(t.db, { provider: dryRunProvider(() => {}), baseUrl: "https://app.example.com", now: MON_9AM });
    page = await listOutbox(t.db, { view: "sent", page: 1 });
    expect(page.entries[0]).toMatchObject({ status: "sent", isPreview: false });
    expect(page.entries[0].message.sms).toMatch(/Open: https:\/\/app\.example\.com\/l\//);
    expect((await listOutbox(t.db, { view: "waiting", page: 1 })).entries).toEqual([]);
  });

  it("sends a failed message again, keeping what already went", async () => {
    const [row] = await t.db.select().from(notifications);
    await t.db
      .update(notifications)
      .set({
        status: "failed",
        attempts: 5,
        lastError: "Text: Twilio couldn't be reached",
        deliveries: {
          sms: { status: "failed", at: MON_9AM.toISOString(), to: "+16045550101", error: "Twilio couldn't be reached" },
          email: { status: "sent", at: MON_9AM.toISOString(), to: "inspector@example.com", providerId: "em_1" },
        },
      })
      .where(eq(notifications.id, row.id));

    const later = new Date("2026-11-09T18:00:00Z");
    await retryNotification(t.db, row.id, later);
    const [after] = await t.db.select().from(notifications).where(eq(notifications.id, row.id));
    expect(after).toMatchObject({ status: "pending", attempts: 0, lastError: null, sendAfter: later });
    expect(Object.keys(after.deliveries)).toEqual(["email"]);

    await t.db.update(notifications).set({ status: "sent" }).where(eq(notifications.id, row.id));
    await expect(retryNotification(t.db, row.id)).rejects.toThrow("That message has already gone.");
  });
});
