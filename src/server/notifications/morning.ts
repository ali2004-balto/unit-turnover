/**
 * Writes the morning reminders and the managers' summary, once a day, at the
 * "morning messages" time in Settings (or when quiet hours end, if later).
 */
import { and, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appSettings, events, notifications, people } from "@/db/schema";
import { type AppSettings, getSettings } from "@/db/settings";
import { dateInZone } from "@/domain/dates";
import { inQuietHours, localTime } from "@/domain/notifications/policy";
import { type MorningPerson, planMorning } from "@/domain/notifications/reminders";
import { isFinished } from "@/domain/status";
import { listTurnovers } from "../queries/turnovers";

/** Past the morning time, outside quiet hours, and not done yet today. */
export function morningIsDue(now: Date, s: Pick<AppSettings, "timezone" | "digestTime" | "quietHoursStart" | "quietHoursEnd" | "lastMorningRunOn">): boolean {
  if (localTime(now, s.timezone) < s.digestTime) return false;
  if (inQuietHours(now, s.timezone, s.quietHoursStart, s.quietHoursEnd)) return false;
  return s.lastMorningRunOn !== dateInZone(now, s.timezone);
}

/**
 * Queues this morning's messages. `force` writes them now whatever the time
 * (for trying it out); they're still only written once per person per day.
 */
export async function runMorning(db: DB, now = new Date(), opts: { force?: boolean } = {}): Promise<{ ran: boolean; queued: number }> {
  const settings = await getSettings(db);
  if (!opts.force && !morningIsDue(now, settings)) return { ran: false, queued: 0 };
  const today = dateInZone(now, settings.timezone);

  return db.transaction(async (tx) => {
    // Claim the day first, so two servers can't both do it.
    const claimed = await tx
      .update(appSettings)
      .set({ lastMorningRunOn: today })
      .where(and(eq(appSettings.id, 1), or(isNull(appSettings.lastMorningRunOn), ne(appSettings.lastMorningRunOn, today))))
      .returning({ id: appSettings.id });
    if (claimed.length === 0 && !opts.force) return { ran: false, queued: 0 };

    const list = await listTurnovers(tx, { today });
    const openStepIds = list.rows.flatMap((r) => r.turnover.steps.filter((s) => !isFinished(s.status)).map((s) => s.id));
    const [activityRows, personRows] = await Promise.all([
      openStepIds.length === 0
        ? []
        : tx
            .select({ stepId: events.stepId, at: max(events.at) })
            .from(events)
            .where(inArray(events.stepId, openStepIds))
            .groupBy(events.stepId),
      tx.select({ id: people.id, name: people.name, roles: people.roles, active: people.active }).from(people),
    ]);
    const lastActivity = new Map(activityRows.filter((a) => a.stepId && a.at).map((a) => [a.stepId!, new Date(a.at!)]));

    const messages = planMorning({
      today,
      timeZone: settings.timezone,
      people: new Map<string, MorningPerson>(personRows.map((p) => [p.id, p])),
      turnovers: list.rows.map((row) => ({
        turnover: row.turnover,
        label: `${row.propertyName} ${row.turnover.unit}`,
        derived: row.derived,
        pastTarget: row.pastTarget,
        lastActivity,
      })),
    });
    if (messages.length === 0) return { ran: true, queued: 0 };
    const inserted = await tx
      .insert(notifications)
      .values(messages.map((m) => ({ ...m, sendAfter: now, createdAt: now })))
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });
    return { ran: true, queued: inserted.length };
  });
}
