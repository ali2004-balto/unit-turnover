/**
 * What the TV board picks and counts, kept pure so it's tested without a
 * database. The numbers themselves come from the dashboard, summary and report
 * code; this only chooses what fits on the screen.
 */
import { addDays, type DateOnly, dateInZone } from "./dates";

/** The board shows first names only. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** The instant a local wall-clock time ("18:00") happens on a date, in a time zone (clock changes included). */
export function zonedInstant(date: DateOnly, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const parts = format.formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** "Done overnight" covers everything since 6 pm yesterday, local time: before and after midnight alike. */
export function overnightStart(now: Date, timeZone: string): Date {
  return zonedInstant(addDays(dateInZone(now, timeZone), -1), "18:00", timeZone);
}

export interface NeedsYouCard {
  id: string;
  propertyName: string;
  unit: string;
  flag: string;
  activeSteps: Array<{ name: string; assigneeId: string | null }>;
}

export interface NeedsYouItem {
  id: string;
  propertyName: string;
  unit: string;
  flag: string;
  /** Steps assigned to the link's owner that are waiting on them now. */
  yourSteps: string[];
}

/**
 * Cards for the "Needs you" panel: turns with a step that is the owner's
 * turn, plus every blocked or overdue turn. The cards come in worst-first
 * order and keep it.
 */
export function needsYou<T extends NeedsYouCard>(cards: readonly T[], ownerId: string | null): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  for (const c of cards) {
    const yourSteps = ownerId ? c.activeSteps.filter((s) => s.assigneeId === ownerId).map((s) => s.name) : [];
    if (yourSteps.length === 0 && c.flag !== "Blocked" && c.flag !== "Overdue") continue;
    items.push({ id: c.id, propertyName: c.propertyName, unit: c.unit, flag: c.flag, yourSteps });
  }
  return items;
}

/** The first `max` items, and how many were left out ("+N more"). */
export function fit<T>(items: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}
