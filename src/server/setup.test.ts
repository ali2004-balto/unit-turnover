import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { people } from "@/db/schema";
import { createEmptyDb, createTestDb, type TestDb } from "@/test/db";
import { checkPassword } from "./auth/sessions";
import { createFirstManager, needsSetup, setupCodeMatches } from "./setup";

const CODE = "a-long-random-setup-code-from-the-server";
const me = { code: CODE, name: "Ali", email: "Ali@Example.com", password: "a strong password" };

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.handle.close();
});

describe("first-time setup", () => {
  it("creates the first manager, who can then sign in", async () => {
    expect(await needsSetup(t.db)).toBe(true);
    const { personId } = await createFirstManager(t.db, me, CODE);
    expect(await needsSetup(t.db)).toBe(false);
    expect(await checkPassword(t.db, "ali@example.com", "a strong password")).toEqual({ ok: true, personId });
    const [person] = await t.db.select().from(people).where(eq(people.id, personId));
    expect(person).toMatchObject({ name: "Ali", email: "ali@example.com", roles: ["admin"], active: true });
  });

  it("only works once", async () => {
    await createFirstManager(t.db, me, CODE);
    await expect(createFirstManager(t.db, { ...me, email: "someone@example.com" }, CODE)).rejects.toThrow("This app already has a manager. Sign in instead.");
  });

  it("needs the server's setup code", async () => {
    await expect(createFirstManager(t.db, { ...me, code: "guess" }, CODE)).rejects.toThrow("That setup code isn't right.");
    await expect(createFirstManager(t.db, me, undefined)).rejects.toThrow("That setup code isn't right.");
    expect(setupCodeMatches(` ${CODE} `, CODE)).toBe(true);
    expect(setupCodeMatches("", "")).toBe(false);
  });

  it("checks the details", async () => {
    await expect(createFirstManager(t.db, { ...me, password: "short" }, CODE)).rejects.toThrow(/at least 10/);
    await expect(createFirstManager(t.db, { ...me, email: "not an email" }, CODE)).rejects.toThrow(/email/);
  });

  it("works on a brand-new database, filling in the basics", async () => {
    const empty = await createEmptyDb();
    try {
      await createFirstManager(empty.db, me, CODE);
      expect(await needsSetup(empty.db)).toBe(false);
    } finally {
      await empty.close();
    }
  });
});
