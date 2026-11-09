/**
 * Who hears about what, how, and when.
 *
 * - People on steps get messages the way they chose (text, email or both).
 * - Managers get email, except urgent things, which also go the way they
 *   chose: a block, and a morning summary with something that needs them (a
 *   booking that can't happen, or a step with no updates for too long).
 * - No texts during quiet hours (8 pm to 7 am by default): they wait for
 *   the morning. Emails go any time.
 */
import type { Role } from "../workflow/types";
import { URGENT_FOR_MANAGERS } from "./messages";

export type Channel = "sms" | "email";

export interface Recipient {
  roles: Role[];
  phone: string | null;
  email: string | null;
  notifyChannel: "sms" | "email" | "both" | "none";
  active: boolean;
}

export type ChannelChoice = { channels: Channel[] } | { skip: string };

/** `urgent`: a morning summary with something in it that needs a manager today. */
export function chooseChannels(person: Recipient, kind: string, opts: { urgent?: boolean } = {}): ChannelChoice {
  if (!person.active) return { skip: "They're no longer active" };
  if (person.notifyChannel === "none") return { skip: "They chose not to get messages" };
  const preferred: Channel[] =
    person.notifyChannel === "both" ? ["sms", "email"] : person.notifyChannel === "email" ? ["email"] : ["sms"];
  const isManager = person.roles.includes("admin");
  let wanted: Channel[];
  if (!isManager || kind === "sign_in_link" || URGENT_FOR_MANAGERS.has(kind)) wanted = preferred;
  else if (kind === "daily_digest" && opts.urgent && preferred.includes("sms")) wanted = ["sms", "email"];
  else wanted = ["email"];
  const reachable = (c: Channel) => (c === "sms" ? person.phone !== null : person.email !== null);
  const channels = wanted.filter(reachable);
  if (channels.length > 0) return { channels };
  // Fall back to whatever we can reach.
  const fallback = (["sms", "email"] as Channel[]).filter(reachable);
  if (fallback.length > 0) return { channels: [fallback[0]] };
  return { skip: "No phone number or email" };
}

function localMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** True during quiet hours. Handles windows that cross midnight (20:00 to 07:00). */
export function inQuietHours(instant: Date, timeZone: string, start: string, end: string): boolean {
  const now = localMinutes(instant, timeZone);
  const [s, e] = [toMinutes(start), toMinutes(end)];
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** When quiet hours end, as an instant. Only meaningful while inQuietHours. */
export function quietHoursEnd(instant: Date, timeZone: string, end: string): Date {
  const target = toMinutes(end);
  let wait = target - localMinutes(instant, timeZone);
  if (wait <= 0) wait += 24 * 60;
  const at = new Date(instant.getTime() + wait * 60_000);
  // If the clocks changed overnight, the wall clock is off by the change: correct it.
  let drift = target - localMinutes(at, timeZone);
  if (drift > 12 * 60) drift -= 24 * 60;
  if (drift < -12 * 60) drift += 24 * 60;
  at.setTime(at.getTime() + drift * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

/** The current local time "HH:MM" in a time zone. */
export function localTime(instant: Date, timeZone: string): string {
  const minutes = localMinutes(instant, timeZone);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
