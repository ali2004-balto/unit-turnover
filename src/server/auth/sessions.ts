/**
 * Sign-in sessions and manager passwords, without any Next.js dependencies
 * so they can be tested directly. The cookie side lives in ./current.ts.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { credentials, people, sessions } from "@/db/schema";
import type { Role } from "@/domain/workflow/types";
import { hashPassword, verifyPassword } from "./passwords";

export const SESSION_DAYS = { password: 30, link: 30 } as const;
const DAY_MS = 86_400_000;
/** Lock a manager account for 15 minutes after 10 wrong passwords in a row. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCK_MS = 15 * 60_000;

export interface SignedInPerson {
  id: string;
  name: string;
  email: string | null;
  roles: Role[];
}

export interface CurrentSession {
  person: SignedInPerson;
  kind: "password" | "link";
  expiresAt: Date;
}

/** Sessions are looked up by a hash of the token, so a database leak can't be used to sign in. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  ex: Executor,
  personId: string,
  kind: "password" | "link",
  opts: { now?: Date; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS[kind] * DAY_MS);
  await ex.insert(sessions).values({
    id: hashToken(token),
    personId,
    kind,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** The signed-in person for a cookie token, or null if it's unknown, expired, or the person was deactivated. */
export async function findSession(ex: Executor, token: string, now = new Date()): Promise<CurrentSession | null> {
  if (!token || token.length > 200) return null;
  const id = hashToken(token);
  const [row] = await ex
    .select({
      kind: sessions.kind,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      person: { id: people.id, name: people.name, email: people.email, roles: people.roles, active: people.active },
    })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .where(eq(sessions.id, id));
  if (!row || row.expiresAt <= now || !row.person.active) return null;

  // Keep active sessions alive: extend at most once a day.
  if (now.getTime() - row.lastSeenAt.getTime() > DAY_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_DAYS[row.kind] * DAY_MS);
    await ex.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, id));
    row.expiresAt = expiresAt;
  }
  const { active: _active, ...person } = row.person;
  return { person, kind: row.kind, expiresAt: row.expiresAt };
}

export async function deleteSession(ex: Executor, token: string): Promise<void> {
  await ex.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Signs a person out everywhere (lost phone, left the company). */
export async function deleteSessionsFor(ex: Executor, personId: string): Promise<void> {
  await ex.delete(sessions).where(eq(sessions.personId, personId));
}

export async function setPassword(ex: Executor, personId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await ex
    .insert(credentials)
    .values({ personId, passwordHash })
    .onConflictDoUpdate({
      target: credentials.personId,
      set: { passwordHash, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() },
    });
}

export type LoginResult = { ok: true; personId: string } | { ok: false; reason: "invalid" | "locked" };

// Verifying against this when the email is unknown keeps the response time the same either way.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$vc+SWGajoX3L8gwQfQIrWCQjq06updc6QVyvl7E3ruQ";

/** Checks a manager's email and password. Only active people with the manager role can sign in this way. */
export async function checkPassword(ex: Executor, email: string, password: string, now = new Date()): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const [row] = await ex
    .select({ id: people.id, roles: people.roles, hash: credentials.passwordHash, failed: credentials.failedAttempts, lockedUntil: credentials.lockedUntil })
    .from(people)
    .innerJoin(credentials, eq(credentials.personId, people.id))
    .where(and(sql`lower(${people.email}) = ${normalized}`, eq(people.active, true)));

  if (!row || !row.roles.includes("admin")) {
    await verifyPassword(DUMMY_HASH, password);
    return { ok: false, reason: "invalid" };
  }
  if (row.lockedUntil && row.lockedUntil > now) return { ok: false, reason: "locked" };

  if (!(await verifyPassword(row.hash, password))) {
    const failed = row.failed + 1;
    await ex
      .update(credentials)
      .set({
        failedAttempts: failed >= MAX_FAILED_ATTEMPTS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_MS) : null,
      })
      .where(eq(credentials.personId, row.id));
    return { ok: false, reason: failed >= MAX_FAILED_ATTEMPTS ? "locked" : "invalid" };
  }
  if (row.failed > 0 || row.lockedUntil) {
    await ex.update(credentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(credentials.personId, row.id));
  }
  return { ok: true, personId: row.id };
}
