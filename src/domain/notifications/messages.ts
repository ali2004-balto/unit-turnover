/**
 * What each notification says, as a text message and as an email.
 *
 * Texts are short, plain and say what to do: unit, step, what changed, the
 * link. They stick to characters every phone network handles (no emoji or
 * curly quotes), so a message is charged as one or two parts, not four.
 */
import { formatShort, isDateOnly } from "../dates";
import type { Attention, Digest, TaskReminder } from "./reminders";

export interface MessageInput {
  kind: string;
  /** "Acadian 203", or null for messages that aren't about one unit. */
  unit: string | null;
  stepName: string | null;
  data: Record<string, unknown>;
  /** Their sign-in link (people on steps) or the app page (managers). Null when there's nothing to open. */
  link: string | null;
  /** The app's address, for links to single turnovers in the morning summary. */
  appUrl?: string | null;
}

export interface RenderedMessage {
  sms: string;
  subject: string;
  text: string;
}

/** What the Outbox calls each kind of message. */
export const MESSAGE_LABELS: Record<string, string> = {
  step_assigned: "Task ready",
  step_ready_booked: "Booked task ready",
  step_sent_back: "Sent back to them",
  needs_assignee: "Nobody assigned",
  booking_created: "Booking made",
  step_scheduled: "Booking made",
  booking_cancelled: "Booking cancelled",
  step_unassigned: "Given to someone else",
  step_cancelled: "No longer needed",
  step_blocked: "Blocked",
  step_unblocked: "Unblocked",
  send_back_alert: "Unit sent back",
  turnover_completed: "Turnover complete",
  sign_in_link: "Sign-in link",
  daily_tasks: "Morning reminder",
  daily_digest: "Morning summary",
};

/**
 * Sent to managers by text as well as email. Everything else to managers is
 * email only, apart from the morning summary, which also goes by text when
 * something in it needs them.
 */
export const URGENT_FOR_MANAGERS = new Set(["step_blocked"]);

/** Messages that need nothing from the person: no link is made for them. */
export const NO_ACTION = new Set(["booking_cancelled", "step_unassigned", "step_cancelled"]);

/** Morning messages: only worth sending on the day they were written for. */
export const MORNING_KINDS = new Set(["daily_tasks", "daily_digest"]);

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (v: unknown) => (typeof v === "string" && isDateOnly(v) ? formatShort(v) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Replaces characters some phones show as boxes, or that make a text cost more. */
export function plainText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E\nÀ-ÿ]/g, "");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

/** "a; b; c", within max characters, ending "and 2 more" when some don't fit. */
export function listWithin(parts: readonly string[], max: number): string {
  const more = (n: number) => `; and ${n} more`;
  let out = "";
  for (const [i, part] of parts.entries()) {
    const next = out ? `${out}; ${part}` : clip(part, max - more(99).length);
    const left = parts.length - i - 1;
    if (next.length + (left > 0 ? more(left).length : 0) > max && out) return out + more(parts.length - i);
    out = next;
  }
  return out;
}

/** Keeps a morning text to about two parts once the link is added. */
const SMS_BUDGET = 300;

function taskReminderKind(item: TaskReminder): string {
  return { booking: "booking_reminder", due: "step_due_today", late: "step_overdue", missed: "booking_missed" }[item.type];
}

function attentionKind(item: Attention): string {
  return item.type === "not_ready" ? "booking_conflict" : "escalation";
}

function dailyTasks(items: TaskReminder[], link: string | null): RenderedMessage {
  if (items.length === 1) {
    const [item] = items;
    return renderMessage({ kind: taskReminderKind(item), unit: item.unit, stepName: item.stepName, data: { ...item }, link });
  }
  const what = (i: TaskReminder) => `${i.stepName} at ${i.unit}`;
  const of = <T extends TaskReminder["type"]>(type: T) => items.filter((i): i is Extract<TaskReminder, { type: T }> => i.type === type);
  const booked = of("booking");
  const due = of("due");
  const late = of("late");
  const missed = of("missed");

  const open = link ? ` Open: ${link}` : "";
  const parts = [
    ...booked.map((i) => `Booked today: ${what(i)}${i.time ? ` at ${i.time}` : ""}`),
    ...due.map((i) => `Due today: ${what(i)}`),
    ...late.map((i) => `Late: ${what(i)}`),
    ...missed.map((i) => `Not marked done: ${what(i)} (booked ${day(i.on)})`),
  ];
  let sms = `Good morning. ${parts.join("; ")}.${open}`;
  // A long list reads better as counts, with the details a tap away.
  if (parts.length > 3 || sms.length > SMS_BUDGET) {
    const counts = [
      booked.length && `${booked.length} booked today`,
      due.length && `${due.length} due today`,
      late.length && `${late.length} late`,
      missed.length && `${plural(missed.length, "booking")} to mark done or book again`,
    ].filter(Boolean);
    sms = `Good morning. You have ${items.length} things on your list: ${counts.join(", ")}.${open}`;
  }

  const lines = ["Good morning. Here's your day:"];
  const section = (title: string, rows: string[]) => {
    if (rows.length > 0) lines.push("", title, ...rows.map((r) => `- ${r}`));
  };
  section("Booked today", booked.map((i) => `${what(i)}${i.time ? `, ${i.time}` : ""}`));
  section("Due today", due.map(what));
  section("Late", late.map((i) => `${what(i)} (was due ${day(i.dueOn)})`));
  section("Booked but not marked done. Did these happen? Mark them done, or book a new time.", missed.map((i) => `${what(i)} (booked ${day(i.on)})`));
  if (link) lines.push("", `Open your tasks: ${link}`);
  lines.push("", "Unit Turnover");

  return { sms, subject: `Your tasks today (${items.length})`, text: lines.join("\n") };
}

function attentionLine(a: Attention): string {
  if (a.type === "not_ready") return `${a.unit}, ${a.stepName}: booked for ${a.when} (${day(a.on)}), but ${a.waitingOn} isn't done.`;
  return `${a.unit}, ${a.stepName}: no updates since ${day(a.since)} (${a.assigneeName ?? "nobody assigned"}, ${a.status.toLowerCase()}).`;
}

function countsLine(c: Digest["counts"]): string {
  if (c.active === 0) return "No turnovers in progress.";
  const parts = [
    c.blocked && `${c.blocked} blocked`,
    c.pastTarget && `${c.pastTarget} past the target date`,
    c.dueSoon && `${c.dueSoon} due soon`,
    c.unassigned && `${plural(c.unassigned, "step")} with nobody assigned`,
  ].filter(Boolean);
  return `${plural(c.active, "turnover")} in progress${parts.length ? `: ${parts.join(", ")}` : ", all on track"}.`;
}

function dailyDigest(d: Digest, link: string | null, appUrl: string | null): RenderedMessage {
  const attention = d.attention ?? [];
  const open = link ? ` Open: ${link}` : "";

  let sms: string;
  if (attention.length === 1) {
    const [a] = attention;
    const direct = appUrl ? `${appUrl.replace(/\/+$/, "")}/turnovers/${a.turnoverId}` : link;
    sms = renderMessage({ kind: attentionKind(a), unit: a.unit, stepName: a.stepName, data: { ...a }, link: direct }).sms;
  } else if (attention.length > 1) {
    const parts = attention.map((a) =>
      a.type === "not_ready"
        ? `${a.stepName} at ${a.unit} is booked ${a.when} but ${a.waitingOn} isn't done`
        : `no updates on ${a.stepName} at ${a.unit} since ${day(a.since)}`,
    );
    const lead = `${attention.length} things need you: `;
    sms = `${lead}${listWithin(parts, SMS_BUDGET - lead.length - 1 - open.length)}.${open}`;
  } else {
    sms = `Morning summary: ${countsLine(d.counts)}${open}`;
  }

  const MAX_LINES = 12;
  const lines = [`Good morning. Here's where things stand on ${day(d.day)}.`, countsLine(d.counts)];
  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    lines.push("", title.toUpperCase(), ...rows.slice(0, MAX_LINES).map((r) => `- ${r}`));
    if (rows.length > MAX_LINES) lines.push(`- and ${rows.length - MAX_LINES} more`);
  };
  const who = (name: string | null) => (name ? ` (${name})` : "");
  // "3. In-house work" is the sheet's stage label; in a sentence the step's name reads better.
  const stage = (label: string) => label.replace(/^\d+\.\s*/, "");
  section("Needs you", attention.map(attentionLine));
  section(
    "Blocked",
    d.blocked.map((b) => `${b.unit}, ${b.stepName}${who(b.assigneeName)}${b.since ? `, since ${day(b.since)}` : ""}: ${b.reason ?? "no reason given"}`),
  );
  section("Nobody assigned", d.unassigned.map((u) => `${u.unit}, ${u.stepName}${u.since ? `, since ${day(u.since)}` : ""}`));
  section("Past the target date", d.pastTarget.map((p) => `${p.unit}: target was ${day(p.target) ?? "not set"}, now at ${stage(p.stage)}`));
  section("Due soon", d.dueSoon.map((p) => `${p.unit}: target ${day(p.target) ?? "not set"}, now at ${stage(p.stage)}`));
  section("No updates for a while", d.stalled.map((s) => `${s.unit}, ${s.stepName}${who(s.assigneeName)}: nothing since ${day(s.since)}`));
  section("Late tasks", d.lateTasks.map((l) => `${l.unit}, ${l.stepName}${who(l.assigneeName)}: was due ${day(l.dueOn)}`));
  section(
    "Booked today",
    d.bookedToday.map(
      (b) => `${b.unit}, ${b.stepName}${who(b.assigneeName)}${b.time ? ` at ${b.time}` : ""}${b.waitingOn ? `: not ready, waiting on ${b.waitingOn}` : ""}`,
    ),
  );
  section("Done yesterday", [
    ...d.completedYesterday.map((c) => `${c.unit} is rent-ready${c.daysVacant !== null ? ` after ${plural(c.daysVacant, "day")} vacant` : ""}`),
    ...d.doneYesterday.map((s) => `${s.unit}, ${s.stepName}${who(s.assigneeName)}`),
  ]);
  if (link) lines.push("", `Open the dashboard: ${link}`);
  lines.push("", "Unit Turnover");

  const subject =
    attention.length > 0 ? `Morning summary: ${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} you` : `Morning summary for ${day(d.day)}`;
  return { sms, subject, text: lines.join("\n") };
}

export function renderMessage(m: MessageInput): RenderedMessage {
  const d = m.data;
  if (m.kind === "daily_tasks") return finish(dailyTasks(Array.isArray(d.items) ? (d.items as TaskReminder[]) : [], m.link));
  if (m.kind === "daily_digest") return finish(dailyDigest(d as unknown as Digest, m.link, m.appUrl ?? null));

  const unit = m.unit ?? "A unit";
  const step = m.stepName ?? "a step";
  const open = m.link ? ` Open: ${m.link}` : "";
  const when = (on: unknown, time: unknown) => {
    const date = day(on);
    if (!date) return "";
    return str(time) ? `${date} at ${str(time)}` : date;
  };
  const reason = (v: unknown) => (str(v) ? clip(str(v)!, 160) : null);

  let sms: string;
  let subject: string;
  switch (m.kind) {
    case "step_assigned": {
      const due = day(d.dueOn);
      sms = d.reassigned
        ? `${unit}: ${step} has been given to you${due ? `, due ${due}` : ""}.${open}`
        : `${unit}: ${step} is ready for you${due ? `, due ${due}` : ""}.${open}`;
      subject = `${unit}: ${step} is ready for you`;
      break;
    }
    case "step_ready_booked":
      sms = `${unit}: ${step} is ready for you (you're booked ${when(d.scheduledOn, d.scheduledTime) || "soon"}).${open}`;
      subject = `${unit}: ${step} is ready for you`;
      break;
    case "step_sent_back":
      sms = `${unit} was sent back to you from ${str(d.fromStepName) ?? "a later step"}: ${reason(d.reason) ?? "see the task"}.${open}`;
      subject = `${unit} was sent back to you`;
      break;
    case "needs_assignee":
      sms = `${unit}: ${step} is ready but nobody is assigned.${open}`;
      subject = `${unit}: ${step} needs someone assigned`;
      break;
    case "booking_created":
      sms = `You're booked for ${step} at ${unit} on ${when(d.on, d.time)}. We'll text you when it's ready.${open}`;
      subject = `Booked: ${step} at ${unit}, ${when(d.on, d.time)}`;
      break;
    case "step_scheduled":
      sms = `${step} at ${unit} is booked for ${when(d.on, d.time)}.${open}`;
      subject = `Booked: ${step} at ${unit}, ${when(d.on, d.time)}`;
      break;
    case "booking_cancelled":
      sms = `Your ${step} booking at ${unit}${day(d.on) ? ` (${day(d.on)})` : ""} is cancelled.${reason(d.reason) ? ` ${reason(d.reason)}.` : ""}`;
      subject = `Cancelled: ${step} at ${unit}`;
      break;
    case "step_unassigned":
      sms = `${step} at ${unit} has been given to someone else. Nothing to do.`;
      subject = `${step} at ${unit} was reassigned`;
      break;
    case "step_cancelled":
      sms = `${step} at ${unit} isn't needed any more${reason(d.reason) ? `: ${reason(d.reason)}` : ""}.`;
      subject = `No longer needed: ${step} at ${unit}`;
      break;
    case "step_blocked":
      sms = `Blocked: ${unit}, ${step}: ${reason(d.reason) ?? "no reason given"}.${open}`;
      subject = `Blocked: ${unit}, ${step}`;
      break;
    case "step_unblocked":
      sms = `${unit}: ${step} is unblocked${reason(d.note) ? ` (${reason(d.note)})` : ""}.${open}`;
      subject = `Unblocked: ${unit}, ${step}`;
      break;
    case "send_back_alert":
      sms = `${unit} was sent back from ${step} to ${str(d.toStepName) ?? "an earlier step"}: ${reason(d.reason) ?? ""}.${open}`;
      subject = `Sent back: ${unit}, ${step} to ${str(d.toStepName) ?? "an earlier step"}`;
      break;
    case "turnover_completed":
      sms = `${unit} is complete: rent-ready and listed.${open}`;
      subject = `Complete: ${unit}`;
      break;
    case "sign_in_link":
      sms = `Your Unit Turnover sign-in link (works for 7 days): ${m.link ?? ""}`;
      subject = "Your Unit Turnover sign-in link";
      break;
    // One line of a morning message, when it's the only one.
    case "booking_reminder":
      sms = `Today: ${step} at ${unit}${str(d.time) ? ` at ${str(d.time)}` : ""}.${open}`;
      subject = `Today: ${step} at ${unit}`;
      break;
    case "booking_missed":
      sms = `Did ${step} at ${unit} happen on ${day(d.on)}? Mark it done, or book a new time.${open}`;
      subject = `Did ${step} at ${unit} happen?`;
      break;
    case "step_due_today":
      sms = `Due today: ${step} at ${unit}.${open}`;
      subject = `Due today: ${step} at ${unit}`;
      break;
    case "step_overdue":
      sms = `Late: ${step} at ${unit} was due ${day(d.dueOn) ?? "earlier"}.${open}`;
      subject = `Late: ${step} at ${unit}`;
      break;
    case "booking_conflict": {
      const today = d.when === "today";
      sms = `Heads-up: ${step} at ${unit} is booked for ${today ? "today" : "tomorrow"} (${day(d.on)}) but ${str(d.waitingOn) ?? "an earlier step"} isn't done yet.${open}`;
      subject = `${today ? "Today's" : "Tomorrow's"} booking isn't ready: ${unit}, ${step}`;
      break;
    }
    case "escalation":
      sms = `${unit}: no updates on ${step} since ${day(d.since) ?? "it started"} (${str(d.assigneeName) ?? "nobody assigned"}${str(d.status) ? `, ${str(d.status)!.toLowerCase()}` : ""}).${open}`;
      subject = `No updates: ${unit}, ${step}`;
      break;
    default:
      sms = `${unit}: ${step} changed.${open}`;
      subject = `${unit}: update`;
  }

  const body = sms.replace(` Open: ${m.link}`, "");
  return finish({ sms, subject, text: `${body}\n\n${m.link ? `Open it here: ${m.link}\n\n` : ""}Unit Turnover` });
}

function finish(r: RenderedMessage): RenderedMessage {
  return { sms: plainText(r.sms), subject: plainText(r.subject), text: plainText(r.text) };
}

/** Hides the secret part of sign-in links, for messages kept in the outbox after they're sent. */
export function redactLinks(text: string): string {
  return text.replace(/\/l\/[A-Za-z0-9_-]{8,}/g, "/l/[link]");
}
