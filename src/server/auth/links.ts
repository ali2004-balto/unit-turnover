/**
 * Sign-in links for people without a password: inspectors, crews, cleaners,
 * photographers and leasing staff.
 *
 * - A link is 128 random bits; only its hash is stored.
 * - It works for 7 days and can be used more than once in that time, so a
 *   message app's link preview can't use it up.
 * - Opening one signs the phone in for a year (see openLink). On a phone
 *   that's already signed in as its person, even an expired link opens the
 *   task: the link travels in messages that can be forwarded, the sign-in
 *   stays on the phone.
 * - It signs its person in to their own tasks only. Manager screens always
 *   need a password, even for a manager who opens a link.
 * - Revoking (Settings → People → Sign out) stops all of a person's links.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { accessLinks, notifications, people } from "@/db/schema";
import { createSession, findSession, hashToken, renewSession } from "./sessions";

export const LINK_DAYS = 7;
const DAY_MS = 86_400_000;
/** At most this many link requests per person in REQUEST_WINDOW_MS. */
const MAX_REQUESTS = 3;
const REQUEST_WINDOW_MS = 15 * 60_000;

export type LinkPurpose = "manual" | "request" | "notification";

export async function createAccessLink(
  ex: Executor,
  personId: string,
  opts: { purpose: LinkPurpose; stepId?: string | null; createdById?: string | null; now?: Date },
): Promise<{ token: string; expiresAt: Date }> {
  const now = opts.now ?? new Date();
  const token = randomBytes(16).toString("base64url");
  const expiresAt = new Date(now.getTime() + LINK_DAYS * DAY_MS);
  await ex.insert(accessLinks).values({
    id: hashToken(token),
    personId,
    purpose: opts.purpose,
    stepId: opts.stepId ?? null,
    createdById: opts.createdById ?? null,
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export type LinkCheck =
  | { ok: true; personId: string; stepId: string | null }
  | { ok: false; reason: "unknown" | "revoked" | "inactive"; personId?: string }
  | { ok: false; reason: "expired"; personId: string; stepId: string | null };

/** Checks a link and records its use. */
export async function redeemAccessLink(ex: Executor, token: string, now = new Date()): Promise<LinkCheck> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, reason: "unknown" };
  const id = hashToken(token);
  const [row] = await ex
    .select({ link: accessLinks, active: people.active })
    .from(accessLinks)
    .innerJoin(people, eq(people.id, accessLinks.personId))
    .where(eq(accessLinks.id, id));
  if (!row) return { ok: false, reason: "unknown" };
  const { link } = row;
  if (link.revokedAt) return { ok: false, reason: "revoked", personId: link.personId };
  if (!row.active) return { ok: false, reason: "inactive" };
  if (link.expiresAt <= now) return { ok: false, reason: "expired", personId: link.personId, stepId: link.stepId };
  await ex
    .update(accessLinks)
    .set({ lastUsedAt: now, useCount: sql`${accessLinks.useCount} + 1` })
    .where(eq(accessLinks.id, id));
  return { ok: true, personId: link.personId, stepId: link.stepId };
}

export type LinkOpening =
  | { ok: true; personId: string; stepId: string | null; session: { token: string; expiresAt: Date } }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "inactive" };

/**
 * Someone opened a sign-in link on a device. `deviceSession` is the task
 * sign-in the device already has, if any. Signed in as the link's person, the
 * device keeps that sign-in, renewed for another year, and the task opens even
 * if the link has expired. Otherwise a working link signs the device in.
 */
export async function openLink(
  ex: Executor,
  token: string,
  opts: { deviceSession?: string; now?: Date; userAgent?: string | null } = {},
): Promise<LinkOpening> {
  const now = opts.now ?? new Date();
  const check = await redeemAccessLink(ex, token, now);
  const target = check.ok || check.reason === "expired" ? { personId: check.personId, stepId: check.stepId } : null;
  if (target && opts.deviceSession) {
    const device = await findSession(ex, opts.deviceSession, now);
    if (device?.kind === "link" && device.person.id === target.personId) {
      const expiresAt = await renewSession(ex, opts.deviceSession, now);
      if (expiresAt) return { ok: true, ...target, session: { token: opts.deviceSession, expiresAt } };
    }
  }
  if (!check.ok) return { ok: false, reason: check.reason };
  const session = await createSession(ex, check.personId, "link", { now, userAgent: opts.userAgent });
  return { ok: true, personId: check.personId, stepId: check.stepId, session };
}

export async function revokeLinksFor(ex: Executor, personId: string, now = new Date()): Promise<void> {
  await ex
    .update(accessLinks)
    .set({ revokedAt: now })
    .where(and(eq(accessLinks.personId, personId), isNull(accessLinks.revokedAt)));
}

export function linkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/l/${token}`;
}

/**
 * Someone asked for a new link (by phone or email, or from an expired link).
 * Queues a sign-in message to the phone or email on file; the sender adds a
 * fresh link when it goes out. Returns the person, or null when nothing was
 * queued (no match, or too many requests). The caller says the same thing
 * either way, so this can't be used to find out who's on the team.
 */
export async function requestSignInLink(
  ex: Executor,
  who: { personId: string } | { identifier: string },
  now = new Date(),
): Promise<{ personId: string; name: string } | null> {
  let person: { id: string; name: string; active: boolean } | undefined;
  if ("personId" in who) {
    [person] = await ex.select({ id: people.id, name: people.name, active: people.active }).from(people).where(eq(people.id, who.personId));
  } else {
    const raw = who.identifier.trim().toLowerCase();
    if (!raw || raw.length > 200) return null;
    const digits = raw.replace(/[^\d]/g, "");
    const phone = raw.includes("@") ? null : digits.length === 10 ? `+1${digits}` : digits.length >= 11 ? `+${digits}` : null;
    if (!raw.includes("@") && !phone) return null;
    [person] = await ex
      .select({ id: people.id, name: people.name, active: people.active })
      .from(people)
      .where(raw.includes("@") ? sql`lower(${people.email}) = ${raw}` : eq(people.phone, phone!));
  }
  if (!person || !person.active) return null;

  const recent = await ex
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, person.id),
        eq(notifications.kind, "sign_in_link"),
        gt(notifications.createdAt, new Date(now.getTime() - REQUEST_WINDOW_MS)),
      ),
    );
  if (recent.length >= MAX_REQUESTS) return null;

  await ex.insert(notifications).values({
    recipientId: person.id,
    kind: "sign_in_link",
    data: {},
    createdAt: now,
    sendAfter: now,
  });
  return { personId: person.id, name: person.name };
}
