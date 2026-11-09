import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appSettings, notifications, people } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";
import { redeemAccessLink } from "../auth/links";
import { createTurnover, runCommand } from "../workflow";
import { type MessageProvider, SendError } from "./providers";
import { RETRY_MINUTES, sendDue } from "./sender";

let t: TestDb;
const APP = "https://app.example.com";
// Fixed UTC-8, so 17:00 UTC is 9 am and quiet hours (8 pm to 7 am) are 04:00 to 15:00 UTC.
const at = (iso: string) => new Date(iso);
const MON_9AM = at("2026-11-09T17:00:00Z");

beforeEach(async () => {
  t = await createTestDb();
  await t.db.update(appSettings).set({ timezone: "Etc/GMT+8" });
  await t.db.update(people).set({ phone: "+16045550101", notifyChannel: "sms" }).where(eq(people.id, t.ids.inspector));
  await t.db
    .update(people)
    .set({ phone: "+16045550100", email: "manager@example.com", notifyChannel: "both" })
    .where(eq(people.id, t.ids.admin));
});
afterEach(async () => {
  await t.handle.close();
});

type Sent = { channel: "sms" | "email"; to: string; body: string; subject?: string };

function fakeProvider(opts: { mode?: "dry-run" | "live"; failSms?: () => SendError; failEmail?: () => SendError } = {}) {
  const sent: Sent[] = [];
  const provider: MessageProvider = {
    mode: opts.mode ?? "dry-run",
    async sendSms(m) {
      if (opts.failSms) throw opts.failSms();
      sent.push({ channel: "sms", to: m.to, body: m.body });
      return { id: `SM${sent.length}` };
    },
    async sendEmail(m) {
      if (opts.failEmail) throw opts.failEmail();
      sent.push({ channel: "email", to: m.to, body: m.text, subject: m.subject });
      return { id: `email-${sent.length}` };
    },
  };
  return { provider, sent };
}

async function newAcadian203(now = MON_9AM) {
  const result = await createTurnover(
    t.db,
    { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: "2026-11-02" },
    { actor: t.as(t.ids.admin), now },
  );
  return result.turnover;
}

const rows = () => t.db.select().from(notifications).orderBy(asc(notifications.createdAt), asc(notifications.kind));

describe("sending", () => {
  it("texts the inspector a link that opens their task", async () => {
    const turnover = await newAcadian203();
    const { provider, sent } = fakeProvider();
    expect(await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM })).toMatchObject({ sent: 1 });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "sms", to: "+16045550101" });
    expect(sent[0].body).toMatch(/^Acadian 203: Inspection is ready for you, due Wed Nov 11\. Open: https:\/\/app\.example\.com\/l\/[\w-]{22}$/);
    const token = sent[0].body.split("/l/")[1];
    expect(await redeemAccessLink(t.db, token)).toEqual({ ok: true, personId: t.ids.inspector, stepId: turnover.steps[0].id });

    const [row] = await rows();
    expect(row).toMatchObject({ status: "sent", channel: "sms", attempts: 1, sentAt: MON_9AM, claimedAt: null, lastError: null });
    expect(row.deliveries.sms).toMatchObject({ status: "sent", to: "+16045550101", providerId: "SM1" });
    // Dry run keeps the whole text, link included, so it can be tried from the Outbox.
    expect(row.rendered?.sms).toBe(sent[0].body);
  });

  it("keeps real sign-in links out of the outbox", async () => {
    await newAcadian203();
    const { provider } = fakeProvider({ mode: "live" });
    await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM });
    const [row] = await rows();
    expect(row.rendered?.sms).toBe("Acadian 203: Inspection is ready for you, due Wed Nov 11. Open: https://app.example.com/l/[link]");
  });

  it("gives managers the page itself rather than a sign-in link", async () => {
    const turnover = await newAcadian203();
    await runCommand(t.db, turnover.id, { type: "block", stepId: turnover.steps[0].id, reason: "No keys" }, { actor: t.as(t.ids.inspector), now: MON_9AM });
    const { provider, sent } = fakeProvider();
    await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM });
    const toManager = sent.filter((s) => s.to !== "+16045550101");
    expect(toManager.map((s) => s.channel)).toEqual(["sms", "email"]);
    expect(toManager[0].body).toBe(`Blocked: Acadian 203, Inspection: No keys. Open: ${APP}/turnovers/${turnover.id}`);
    expect(toManager[1]).toMatchObject({ to: "manager@example.com", subject: "Blocked: Acadian 203, Inspection" });
  });

  it("holds texts overnight and sends them at 7 am; emails go straight away", async () => {
    const nine_pm = at("2026-11-10T05:00:00Z");
    const turnover = await newAcadian203(nine_pm);
    await runCommand(t.db, turnover.id, { type: "block", stepId: turnover.steps[0].id, reason: "No keys" }, { actor: t.as(t.ids.inspector), now: nine_pm });
    const { provider, sent } = fakeProvider();

    expect(await sendDue(t.db, { provider, baseUrl: APP, now: nine_pm })).toMatchObject({ sent: 0, waiting: 2 });
    expect(sent.map((s) => s.channel)).toEqual(["email"]); // the manager's email
    const held = (await rows()).filter((r) => r.status === "pending");
    expect(held.map((r) => r.sendAfter.toISOString())).toEqual(["2026-11-10T15:00:00.000Z", "2026-11-10T15:00:00.000Z"]);

    expect(await sendDue(t.db, { provider, baseUrl: APP, now: at("2026-11-10T14:59:00Z") })).toMatchObject({ sent: 0, waiting: 0 });
    expect(await sendDue(t.db, { provider, baseUrl: APP, now: at("2026-11-10T15:00:00Z") })).toMatchObject({ sent: 2 });
    expect(sent.map((s) => s.channel)).toEqual(["email", "sms", "sms"]);
    const blocked = (await rows()).find((r) => r.kind === "step_blocked")!;
    expect(blocked).toMatchObject({ status: "sent", channel: "sms,email" });
    expect(blocked.deliveries.email?.at).toBe("2026-11-10T05:00:00.000Z");
    expect(blocked.deliveries.sms?.at).toBe("2026-11-10T15:00:00.000Z");
  });

  it("retries after 1, 5, 15 and 60 minutes, then gives up", async () => {
    await newAcadian203();
    const { provider } = fakeProvider({ failSms: () => new SendError("Twilio couldn't be reached: timeout", false) });
    let now = MON_9AM;
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      await sendDue(t.db, { provider, baseUrl: APP, now });
      const [row] = await rows();
      if (row.status !== "pending") break;
      waits.push((row.sendAfter.getTime() - now.getTime()) / 60_000);
      now = row.sendAfter;
    }
    expect(waits).toEqual(RETRY_MINUTES);
    const [row] = await rows();
    expect(row).toMatchObject({ status: "failed", attempts: 5, lastError: "Text: Twilio couldn't be reached: timeout" });
  });

  it("doesn't retry something that can't work, like a wrong number", async () => {
    await newAcadian203();
    const { provider } = fakeProvider({ failSms: () => new SendError("Twilio said no (code 21211): Invalid 'To' Phone Number", true) });
    expect(await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM })).toMatchObject({ failed: 1 });
    expect((await rows())[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("skips people it can't reach, and says why", async () => {
    await t.db.update(people).set({ phone: null }).where(eq(people.id, t.ids.inspector));
    await newAcadian203();
    const { provider, sent } = fakeProvider();
    expect(await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM })).toMatchObject({ skipped: 1 });
    expect(sent).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: "skipped", lastError: "No phone number or email." });
  });

  it("never texts placeholder people for real", async () => {
    await t.db.update(people).set({ isPlaceholder: true }).where(eq(people.id, t.ids.inspector));
    await newAcadian203();
    const live = fakeProvider({ mode: "live" });
    await sendDue(t.db, { provider: live.provider, baseUrl: APP, now: MON_9AM });
    expect(live.sent).toEqual([]);
    expect((await rows())[0].lastError).toMatch(/^Placeholder person/);
  });

  it("drops a morning message that missed its morning", async () => {
    await t.db.insert(notifications).values({
      recipientId: t.ids.inspector,
      kind: "daily_tasks",
      data: { day: "2026-11-08", items: [] },
      sendAfter: MON_9AM,
    });
    const { provider, sent } = fakeProvider();
    await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM });
    expect(sent).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: "skipped", lastError: "Out of date: it was for an earlier morning." });
  });

  it("sends each message once, even with two senders at the same time", async () => {
    await newAcadian203();
    await createTurnover(t.db, { propertyId: t.propertyIds.get("Acadian")!, unit: "204", moveOutDate: null }, { actor: t.as(t.ids.admin), now: MON_9AM });
    const { provider, sent } = fakeProvider();
    await Promise.all([
      sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM }),
      sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM }),
    ]);
    expect(sent.map((s) => s.body.split(":")[0]).sort()).toEqual(["Acadian 203", "Acadian 204"]);
  });

  it("picks up a send that crashed part-way, after a while", async () => {
    await newAcadian203();
    await t.db.update(notifications).set({ status: "sending", claimedAt: at("2026-11-09T16:55:00Z") });
    const { provider, sent } = fakeProvider();
    await sendDue(t.db, { provider, baseUrl: APP, now: MON_9AM });
    expect(sent).toEqual([]); // claimed 5 minutes ago: still someone else's
    await sendDue(t.db, { provider, baseUrl: APP, now: at("2026-11-09T17:06:00Z") });
    expect(sent).toHaveLength(1);
  });
});
