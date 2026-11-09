import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credentials, people, sessions } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/db";
import { checkPassword, createSession, deleteSession, deleteSessionsFor, findSession, hashToken, setPassword } from "./sessions";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await t.db.update(people).set({ email: "boss@example.com" }).where(eq(people.id, t.ids.admin));
  await t.db.update(people).set({ email: "crew@example.com" }).where(eq(people.id, t.ids.crew));
});
afterEach(async () => {
  await t.handle.close();
});

const NOW = new Date("2026-11-09T17:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("sessions", () => {
  it("finds the person for a valid token, and stores only a hash of it", async () => {
    const { token } = await createSession(t.db, t.ids.admin, "password", { now: NOW });
    const found = await findSession(t.db, token, NOW);
    expect(found?.person).toMatchObject({ id: t.ids.admin, name: "Admin", roles: ["admin"] });
    const [row] = await t.db.select().from(sessions);
    expect(row.id).toBe(hashToken(token));
    expect(row.id).not.toContain(token);
  });

  it("rejects unknown, expired and signed-out tokens", async () => {
    const { token } = await createSession(t.db, t.ids.admin, "password", { now: NOW });
    expect(await findSession(t.db, "made-up-token", NOW)).toBeNull();
    expect(await findSession(t.db, token, days(31))).toBeNull();
    await deleteSession(t.db, token);
    expect(await findSession(t.db, token, NOW)).toBeNull();
  });

  it("keeps a session alive while it's used, at most one write a day", async () => {
    const { token } = await createSession(t.db, t.ids.admin, "password", { now: NOW });
    expect(await findSession(t.db, token, days(25))).not.toBeNull();
    expect(await findSession(t.db, token, days(50))).not.toBeNull(); // extended at day 25
  });

  it("stops working when the person is deactivated or signed out everywhere", async () => {
    const a = await createSession(t.db, t.ids.crew, "link", { now: NOW });
    const b = await createSession(t.db, t.ids.crew, "link", { now: NOW });
    await t.db.update(people).set({ active: false }).where(eq(people.id, t.ids.crew));
    expect(await findSession(t.db, a.token, NOW)).toBeNull();
    await t.db.update(people).set({ active: true }).where(eq(people.id, t.ids.crew));
    await deleteSessionsFor(t.db, t.ids.crew);
    expect(await findSession(t.db, b.token, NOW)).toBeNull();
  });
});

describe("manager passwords", () => {
  beforeEach(async () => {
    await setPassword(t.db, t.ids.admin, "correct horse battery");
  });

  it("accepts the right password, ignoring email case", async () => {
    expect(await checkPassword(t.db, " Boss@Example.com ", "correct horse battery", NOW)).toEqual({ ok: true, personId: t.ids.admin });
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    expect(await checkPassword(t.db, "boss@example.com", "wrong", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await checkPassword(t.db, "nobody@example.com", "correct horse battery", NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("only lets managers sign in with a password", async () => {
    await setPassword(t.db, t.ids.crew, "crew password 123");
    expect(await checkPassword(t.db, "crew@example.com", "crew password 123", NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks the account for 15 minutes after 10 wrong passwords", async () => {
    for (let i = 0; i < 9; i++) await checkPassword(t.db, "boss@example.com", "wrong", NOW);
    expect(await checkPassword(t.db, "boss@example.com", "wrong", NOW)).toEqual({ ok: false, reason: "locked" });
    expect(await checkPassword(t.db, "boss@example.com", "correct horse battery", NOW)).toEqual({ ok: false, reason: "locked" });
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(await checkPassword(t.db, "boss@example.com", "correct horse battery", later)).toEqual({ ok: true, personId: t.ids.admin });
    const [row] = await t.db.select().from(credentials);
    expect(row).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });
});
