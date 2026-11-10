import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessLinks, notifications, people } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";
import { createAccessLink, linkUrl, openLink, requestSignInLink, revokeLinksFor, redeemAccessLink } from "./links";
import { deleteSessionsFor, findSession, hashToken } from "./sessions";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await t.db.update(people).set({ phone: "+16045550101", email: "inspector@example.com" }).where(eq(people.id, t.ids.inspector));
});
afterEach(async () => {
  await t.handle.close();
});

const NOW = new Date("2026-11-09T17:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("sign-in links", () => {
  it("signs its person in for 7 days, more than once, and stores only a hash", async () => {
    const { token } = await createAccessLink(t.db, t.ids.inspector, { purpose: "manual", now: NOW });
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await redeemAccessLink(t.db, token, NOW)).toEqual({ ok: true, personId: t.ids.inspector, stepId: null });
    expect(await redeemAccessLink(t.db, token, days(6))).toMatchObject({ ok: true });
    const [row] = await t.db.select().from(accessLinks);
    expect(row).toMatchObject({ id: hashToken(token), useCount: 2 });
    expect(await redeemAccessLink(t.db, token, days(8))).toEqual({ ok: false, reason: "expired", personId: t.ids.inspector, stepId: null });
  });

  it("refuses made-up, revoked and deactivated people's links", async () => {
    const { token } = await createAccessLink(t.db, t.ids.inspector, { purpose: "manual", now: NOW });
    expect(await redeemAccessLink(t.db, "abcdefghijklmnopqrstuv", NOW)).toEqual({ ok: false, reason: "unknown" });
    expect(await redeemAccessLink(t.db, "../../etc/passwd", NOW)).toEqual({ ok: false, reason: "unknown" });
    await t.db.update(people).set({ active: false }).where(eq(people.id, t.ids.inspector));
    expect(await redeemAccessLink(t.db, token, NOW)).toEqual({ ok: false, reason: "inactive" });
    await t.db.update(people).set({ active: true }).where(eq(people.id, t.ids.inspector));
    await revokeLinksFor(t.db, t.ids.inspector, NOW);
    expect(await redeemAccessLink(t.db, token, NOW)).toMatchObject({ ok: false, reason: "revoked" });
  });

  it("builds the link to send", () => {
    expect(linkUrl("https://turnover.example.com/", "abc")).toBe("https://turnover.example.com/l/abc");
  });
});

describe("asking for a new link", () => {
  it("finds the person by phone (typed any way) or email and queues a sign-in message", async () => {
    expect(await requestSignInLink(t.db, { identifier: "(604) 555-0101" }, NOW)).toMatchObject({ personId: t.ids.inspector });
    expect(await requestSignInLink(t.db, { identifier: " Inspector@Example.com " }, NOW)).toMatchObject({ personId: t.ids.inspector });
    const queued = await t.db.select().from(notifications).where(eq(notifications.kind, "sign_in_link"));
    expect(queued).toHaveLength(2);
    expect(queued[0].data).toEqual({}); // no link in the outbox: the sender makes a fresh one
  });

  it("answers nothing for strangers and stops after three requests in 15 minutes", async () => {
    expect(await requestSignInLink(t.db, { identifier: "+16045559999" }, NOW)).toBeNull();
    expect(await requestSignInLink(t.db, { identifier: "hello" }, NOW)).toBeNull();
    for (let i = 0; i < 3; i++) expect(await requestSignInLink(t.db, { personId: t.ids.inspector }, NOW)).not.toBeNull();
    expect(await requestSignInLink(t.db, { personId: t.ids.inspector }, NOW)).toBeNull();
    expect(await requestSignInLink(t.db, { personId: t.ids.inspector }, new Date(NOW.getTime() + 16 * 60_000))).not.toBeNull();
  });
});

describe("opening a link on a phone", () => {
  const link = (now = NOW) => createAccessLink(t.db, t.ids.inspector, { purpose: "notification", now });

  it("signs the phone in for a year, and another link keeps the same sign-in going", async () => {
    const first = await openLink(t.db, (await link()).token, { now: NOW });
    if (!first.ok) throw new Error("expected the link to work");
    expect(first).toMatchObject({ personId: t.ids.inspector, stepId: null });
    expect(first.session.expiresAt).toEqual(days(365));

    const later = await openLink(t.db, (await link(days(300))).token, { deviceSession: first.session.token, now: days(300) });
    if (!later.ok) throw new Error("expected the link to work");
    expect(later.session).toEqual({ token: first.session.token, expiresAt: days(665) });
    expect(await findSession(t.db, first.session.token, days(600))).toMatchObject({ kind: "link", person: { id: t.ids.inspector } });
  });

  it("opens the task from an old link on a phone that's still signed in, but nowhere else", async () => {
    const { token } = await link();
    const phone = await openLink(t.db, token, { now: NOW });
    if (!phone.ok) throw new Error("expected the link to work");

    const weeksLater = await openLink(t.db, token, { deviceSession: phone.session.token, now: days(30) });
    expect(weeksLater).toMatchObject({ ok: true, personId: t.ids.inspector, session: { token: phone.session.token, expiresAt: days(395) } });
    expect(await openLink(t.db, token, { now: days(30) })).toEqual({ ok: false, reason: "expired" });

    const someoneElse = await openLink(t.db, (await createAccessLink(t.db, t.ids.crew, { purpose: "notification", now: days(29) })).token, { now: days(29) });
    if (!someoneElse.ok) throw new Error("expected the link to work");
    expect(await openLink(t.db, token, { deviceSession: someoneElse.session.token, now: days(30) })).toEqual({ ok: false, reason: "expired" });
  });

  it("stops working once a manager signs the person out", async () => {
    const { token } = await link();
    const phone = await openLink(t.db, token, { now: NOW });
    if (!phone.ok) throw new Error("expected the link to work");
    await deleteSessionsFor(t.db, t.ids.inspector);
    await revokeLinksFor(t.db, t.ids.inspector, days(1));
    expect(await openLink(t.db, token, { deviceSession: phone.session.token, now: days(2) })).toEqual({ ok: false, reason: "revoked" });
  });
});
