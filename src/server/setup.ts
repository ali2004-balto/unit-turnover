/**
 * First run on a new server: creating the first manager from the browser,
 * so nobody has to run a command against the production database.
 *
 * It only works while there's no manager who can sign in, and only with the
 * SETUP_TOKEN from the server's settings. Once a manager exists, /setup does
 * nothing, and SETUP_TOKEN can be removed.
 */
import { timingSafeEqual } from "node:crypto";
import { and, arrayContains, eq, sql } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import { appSettings, credentials, people } from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import { passwordProblem } from "./auth/passwords";
import { setPassword } from "./auth/sessions";
import { SettingsError } from "./settings";

/** True until there's an active manager with a password. */
export async function needsSetup(ex: Executor): Promise<boolean> {
  const [manager] = await ex
    .select({ id: credentials.personId })
    .from(credentials)
    .innerJoin(people, eq(people.id, credentials.personId))
    .where(and(eq(people.active, true), arrayContains(people.roles, ["admin"])))
    .limit(1);
  return !manager;
}

export function setupCodeMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createFirstManager(
  db: DB,
  input: { code: string; name: string; email: string; password: string },
  expectedCode: string | undefined,
): Promise<{ personId: string }> {
  if (!setupCodeMatches(input.code, expectedCode)) throw new SettingsError("That setup code isn't right.");
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || name.length > 80) throw new SettingsError("Enter your name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new SettingsError("Enter your email address.");
  const problem = passwordProblem(input.password);
  if (problem) throw new SettingsError(problem);

  return db.transaction(async (tx) => {
    await seedBase(tx);
    // One setup at a time: a second one waits here, then finds the manager already made.
    await tx.select({ id: appSettings.id }).from(appSettings).where(eq(appSettings.id, 1)).for("update");
    if (!(await needsSetup(tx))) throw new SettingsError("This app already has a manager. Sign in instead.");

    const [existing] = await tx.select().from(people).where(sql`lower(${people.email}) = ${email}`);
    let personId: string;
    if (existing) {
      personId = existing.id;
      await tx
        .update(people)
        .set({ name, roles: [...new Set([...existing.roles, "admin" as const])], active: true, isPlaceholder: false })
        .where(eq(people.id, existing.id));
    } else {
      [{ id: personId }] = await tx.insert(people).values({ name, email, roles: ["admin"], notifyChannel: "email" }).returning({ id: people.id });
    }
    await setPassword(tx, personId, input.password);
    return { personId };
  });
}
