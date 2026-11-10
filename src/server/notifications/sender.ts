/**
 * Sends what's waiting in the outbox.
 *
 * Every change that tells someone something queues a row in `notifications`
 * in the same transaction as the change itself. This picks up rows that are
 * due, works out how each person hears (text, email or both), adds a fresh
 * sign-in link, and sends. Then:
 *
 * - texts wait until quiet hours end (emails go any time);
 * - a failed send is retried after 1, 5, 15 and 60 minutes, then given up;
 * - a send that crashed half-way is picked up again after 10 minutes;
 * - two senders running at once never take the same row.
 */
import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { type Deliveries, notifications, people, properties, turnovers } from "@/db/schema";
import { type AppSettings, getSettings } from "@/db/settings";
import { dateInZone } from "@/domain/dates";
import { MORNING_KINDS, NO_ACTION, redactLinks, renderMessage } from "@/domain/notifications/messages";
import { type Channel, chooseChannels, inQuietHours, quietHoursEnd } from "@/domain/notifications/policy";
import { createAccessLink, linkUrl } from "../auth/links";
import { type MessageProvider, SendError } from "./providers";

export const MAX_ATTEMPTS = 5;
/** Minutes to wait before each retry. */
export const RETRY_MINUTES = [1, 5, 15, 60];
const STUCK_MS = 10 * 60_000;
const BATCH = 25;
const CONCURRENCY = 4;

export interface SendOptions {
  provider: MessageProvider;
  /** The app's address, for links ("https://turnover.example.com"). */
  baseUrl: string;
  now?: Date;
  limit?: number;
}

export interface SendReport {
  sent: number;
  /** Texts held for the morning (quiet hours). */
  waiting: number;
  retrying: number;
  failed: number;
  skipped: number;
}

type Row = typeof notifications.$inferSelect;
type Person = typeof people.$inferSelect;
type Outcome = keyof SendReport;

interface Context {
  now: Date;
  today: string;
  settings: AppSettings;
  provider: MessageProvider;
  baseUrl: string;
  people: Map<string, Person>;
  unitLabels: Map<string, string>;
}

/** Hands back rows a crashed sender left half-done. */
async function releaseStuck(db: DB, now: Date): Promise<void> {
  await db
    .update(notifications)
    .set({ status: "pending", claimedAt: null })
    .where(and(eq(notifications.status, "sending"), lt(notifications.claimedAt, new Date(now.getTime() - STUCK_MS))));
}

/** Takes due rows for this sender. Rows another sender holds are skipped, not waited for. */
async function claim(db: DB, now: Date, limit: number): Promise<Row[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.status, "pending"), lte(notifications.sendAfter, now)))
      .orderBy(asc(notifications.sendAfter), asc(notifications.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(notifications)
      .set({ status: "sending", claimedAt: now })
      .where(inArray(notifications.id, due.map((d) => d.id)))
      .returning();
  });
}

async function linkFor(db: DB, row: Row, person: Person, ctx: Context): Promise<string | null> {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  if (row.kind === "sign_in_link") {
    return linkUrl(base, (await createAccessLink(db, person.id, { purpose: "request", now: ctx.now })).token);
  }
  if (NO_ACTION.has(row.kind)) return null;
  // Managers sign in with their password, so they get the page itself.
  if (person.roles.includes("admin")) return row.turnoverId ? `${base}/turnovers/${row.turnoverId}` : `${base}/`;
  const { token } = await createAccessLink(db, person.id, { purpose: "notification", stepId: row.stepId, now: ctx.now });
  return linkUrl(base, token);
}

/** Why a message went nowhere: the only way to reach them isn't set up yet. */
const NOT_SET_UP: Record<Channel, string> = {
  sms: "Texts aren't set up yet. Give them an email address in Settings, People, then retry.",
  email: "Email isn't set up yet. Give them a phone number in Settings, People, then retry.",
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

function failures(deliveries: Deliveries): string | null {
  const lines = (Object.entries(deliveries) as Array<[Channel, Deliveries[Channel]]>)
    .filter(([, d]) => d?.status === "failed")
    .map(([channel, d]) => `${channel === "sms" ? "Text" : "Email"}: ${d!.error}`);
  return lines.length > 0 ? lines.join(" ") : null;
}

async function deliver(db: DB, row: Row, ctx: Context): Promise<Outcome> {
  const settle = async (set: Partial<Row>) => {
    await db.update(notifications).set({ claimedAt: null, ...set }).where(eq(notifications.id, row.id));
  };
  const skip = async (reason: string): Promise<Outcome> => {
    await settle({ status: "skipped", lastError: reason });
    return "skipped";
  };

  const person = ctx.people.get(row.recipientId);
  if (!person) return skip("That person is no longer in the app.");
  if (MORNING_KINDS.has(row.kind) && row.data.day !== ctx.today) return skip("Out of date: it was for an earlier morning.");
  if (person.isPlaceholder && ctx.provider.mode === "live") {
    return skip("Placeholder person: add their real phone or email in Settings, People.");
  }
  const choice = chooseChannels(person, row.kind, { urgent: row.data.urgent === true, available: ctx.provider.channels });
  if ("skip" in choice) return skip(`${choice.skip}.`);

  const { timezone, quietHoursStart, quietHoursEnd: quietEnd } = ctx.settings;
  const deliveries: Deliveries = { ...row.deliveries };
  const todo = choice.channels.filter((c) => deliveries[c]?.status !== "sent" && !deliveries[c]?.permanent);
  const quiet = inQuietHours(ctx.now, timezone, quietHoursStart, quietEnd);
  const canSend = (c: Channel) => ctx.provider.channels.includes(c);
  // Texts wait out quiet hours; one that can't be sent at all says so straight away.
  const sendNow = todo.filter((c) => !(c === "sms" && quiet && canSend(c)));
  const holdingText = todo.length > sendNow.length;

  let rendered = row.rendered;
  if (sendNow.length > 0) {
    const link = await linkFor(db, row, person, ctx);
    const unit = row.turnoverId ? (ctx.unitLabels.get(row.turnoverId) ?? null) : null;
    const stepName = typeof row.data.stepName === "string" ? row.data.stepName : null;
    const message = renderMessage({ kind: row.kind, unit, stepName, data: row.data, link, appUrl: ctx.baseUrl });
    // Sign-in links are kept out of the database once they're real.
    const keep = ctx.provider.mode === "dry-run" ? (t: string) => t : redactLinks;
    rendered = { sms: keep(message.sms), subject: message.subject, text: keep(message.text) };

    for (const channel of sendNow) {
      const to = channel === "sms" ? person.phone! : person.email!;
      const at = ctx.now.toISOString();
      if (!canSend(channel)) {
        deliveries[channel] = { status: "failed", at, to, error: NOT_SET_UP[channel], permanent: true };
        continue;
      }
      try {
        const { id } =
          channel === "sms"
            ? await ctx.provider.sendSms({ to, body: message.sms })
            : await ctx.provider.sendEmail({ to, subject: message.subject, text: message.text, idempotencyKey: `${row.id}-email` });
        deliveries[channel] = { status: "sent", at, to, providerId: id };
      } catch (error) {
        const permanent = error instanceof SendError && error.permanent;
        deliveries[channel] = { status: "failed", at, to, error: errorText(error), ...(permanent ? { permanent: true } : {}) };
      }
    }
  }

  const attempts = row.attempts + (sendNow.length > 0 ? 1 : 0);
  const common = { deliveries, rendered, attempts, channel: choice.channels.join(","), lastError: failures(deliveries) };
  const retryable = sendNow.filter((c) => deliveries[c]?.status === "failed" && !deliveries[c]?.permanent);
  const morning = holdingText ? quietHoursEnd(ctx.now, timezone, quietEnd) : null;

  if (retryable.length > 0 && attempts < MAX_ATTEMPTS) {
    // A held text is looked at again then too, and keeps waiting if it's still quiet hours.
    const retryAt = new Date(ctx.now.getTime() + RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1] * 60_000);
    await settle({ ...common, status: "pending", sendAfter: retryAt });
    return "retrying";
  }
  if (morning) {
    await settle({ ...common, status: "pending", sendAfter: morning });
    return "waiting";
  }
  const sentAny = Object.values(deliveries).some((d) => d?.status === "sent");
  await settle({ ...common, status: sentAny ? "sent" : "failed", sentAt: sentAny ? ctx.now : null });
  return sentAny ? "sent" : "failed";
}

/** Sends everything that's due. Safe to run from several places at once. */
export async function sendDue(db: DB, opts: SendOptions): Promise<SendReport> {
  const now = opts.now ?? new Date();
  const report: SendReport = { sent: 0, waiting: 0, retrying: 0, failed: 0, skipped: 0 };
  await releaseStuck(db, now);
  const rows = await claim(db, now, opts.limit ?? BATCH);
  if (rows.length === 0) return report;

  const settings = await getSettings(db);
  const personIds = [...new Set(rows.map((r) => r.recipientId))];
  const turnoverIds = [...new Set(rows.map((r) => r.turnoverId).filter((id): id is string => id !== null))];
  const [personRows, unitRows] = await Promise.all([
    db.select().from(people).where(inArray(people.id, personIds)),
    turnoverIds.length === 0
      ? []
      : db
          .select({ id: turnovers.id, unit: turnovers.unit, property: properties.name })
          .from(turnovers)
          .innerJoin(properties, eq(properties.id, turnovers.propertyId))
          .where(inArray(turnovers.id, turnoverIds)),
  ]);
  const ctx: Context = {
    now,
    today: dateInZone(now, settings.timezone),
    settings,
    provider: opts.provider,
    baseUrl: opts.baseUrl,
    people: new Map(personRows.map((p) => [p.id, p])),
    unitLabels: new Map(unitRows.map((u) => [u.id, `${u.property} ${u.unit}`])),
  };

  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        report[await deliver(db, row, ctx)] += 1;
      } catch (error) {
        // Something unexpected (not the provider): leave it for the stuck-row check to retry.
        console.error(`Couldn't send notification ${row.id}`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return report;
}
