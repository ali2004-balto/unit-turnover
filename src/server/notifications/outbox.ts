/**
 * The Outbox: every text and email the app has sent or is about to send, so a
 * manager can see who heard what, and fix what didn't go.
 */
import { count, desc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { type Deliveries, notifications, people, properties, turnovers } from "@/db/schema";
import { NO_ACTION, renderMessage, type RenderedMessage } from "@/domain/notifications/messages";
import { SettingsError } from "../settings";

export const OUTBOX_VIEWS = { all: "All", waiting: "Waiting", sent: "Sent", unsent: "Not sent" } as const;
export type OutboxView = keyof typeof OUTBOX_VIEWS;
export const OUTBOX_PAGE_SIZE = 50;

type Status = (typeof notifications.$inferSelect)["status"];
const STATUSES: Record<OutboxView, Status[] | null> = {
  all: null,
  waiting: ["pending", "sending"],
  sent: ["sent"],
  unsent: ["failed", "skipped"],
};

export function parseOutboxView(value: unknown): OutboxView {
  return typeof value === "string" && value in OUTBOX_VIEWS ? (value as OutboxView) : "all";
}

export interface OutboxEntry {
  id: string;
  kind: string;
  status: Status;
  recipientName: string;
  turnoverId: string | null;
  /** "Acadian 203". */
  unit: string | null;
  createdAt: Date;
  sendAfter: Date;
  sentAt: Date | null;
  attempts: number;
  lastError: string | null;
  deliveries: Deliveries;
  /** The words sent, or a preview of them for a message not sent yet. */
  message: RenderedMessage;
  isPreview: boolean;
}

export interface OutboxPage {
  entries: OutboxEntry[];
  hasMore: boolean;
  counts: Record<OutboxView, number>;
}

export async function listOutbox(ex: Executor, opts: { view: OutboxView; page: number }): Promise<OutboxPage> {
  const statuses = STATUSES[opts.view];
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const [rows, totals] = await Promise.all([
    ex
      .select({ n: notifications, recipientName: people.name, unit: turnovers.unit, property: properties.name })
      .from(notifications)
      .innerJoin(people, eq(people.id, notifications.recipientId))
      .leftJoin(turnovers, eq(turnovers.id, notifications.turnoverId))
      .leftJoin(properties, eq(properties.id, turnovers.propertyId))
      .where(statuses ? inArray(notifications.status, statuses) : undefined)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(OUTBOX_PAGE_SIZE + 1)
      .offset((page - 1) * OUTBOX_PAGE_SIZE),
    ex.select({ status: notifications.status, n: count() }).from(notifications).groupBy(notifications.status),
  ]);

  const counts = { all: 0, waiting: 0, sent: 0, unsent: 0 } satisfies Record<OutboxView, number>;
  for (const { status, n } of totals) {
    counts.all += n;
    for (const view of ["waiting", "sent", "unsent"] as const) if (STATUSES[view]!.includes(status)) counts[view] += n;
  }

  const entries = rows.slice(0, OUTBOX_PAGE_SIZE).map(({ n, recipientName, unit, property }): OutboxEntry => {
    const label = unit && property ? `${property} ${unit}` : null;
    const preview =
      n.rendered ??
      renderMessage({
        kind: n.kind,
        unit: label,
        stepName: typeof n.data.stepName === "string" ? n.data.stepName : null,
        data: n.data,
        link: NO_ACTION.has(n.kind) ? null : "[link]",
        appUrl: "[app]",
      });
    return {
      id: n.id,
      kind: n.kind,
      status: n.status,
      recipientName,
      turnoverId: n.turnoverId,
      unit: label,
      createdAt: n.createdAt,
      sendAfter: n.sendAfter,
      sentAt: n.sentAt,
      attempts: n.attempts,
      lastError: n.lastError,
      deliveries: n.deliveries,
      message: preview,
      isPreview: n.rendered === null,
    };
  });
  return { entries, hasMore: rows.length > OUTBOX_PAGE_SIZE, counts };
}

/**
 * Sends a message again: one that failed or was skipped (say, after adding
 * someone's phone number), or one waiting to retry. Channels that already
 * went aren't repeated.
 */
export async function retryNotification(ex: Executor, id: string, now = new Date()): Promise<void> {
  const [row] = await ex.select().from(notifications).where(eq(notifications.id, id));
  if (!row) throw new SettingsError("That message no longer exists.");
  if (row.status === "sent") throw new SettingsError("That message has already gone.");
  if (row.status === "sending") throw new SettingsError("That message is being sent right now.");
  const kept = Object.fromEntries(Object.entries(row.deliveries).filter(([, d]) => d?.status === "sent")) as Deliveries;
  await ex
    .update(notifications)
    .set({ status: "pending", sendAfter: now, attempts: 0, lastError: null, claimedAt: null, deliveries: kept })
    .where(eq(notifications.id, id));
}
