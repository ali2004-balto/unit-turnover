/**
 * What each notification says, as a text message and as an email.
 *
 * Texts are short, plain and say what to do: unit, step, what changed, the
 * link. They stick to characters every phone network handles (no emoji or
 * curly quotes), so a message is charged as one or two parts, not four.
 */
import { formatShort, isDateOnly } from "../dates";

export interface MessageInput {
  kind: string;
  /** "Acadian 203", or null for messages that aren't about one unit. */
  unit: string | null;
  stepName: string | null;
  data: Record<string, unknown>;
  /** Their sign-in link (people on steps) or the app page (managers). Null when there's nothing to open. */
  link: string | null;
}

export interface RenderedMessage {
  sms: string;
  subject: string;
  text: string;
}

/** Sent to managers by text as well as email. Everything else to managers is email only. */
export const URGENT_FOR_MANAGERS = new Set(["step_blocked", "escalation", "booking_conflict"]);

/** Messages that need nothing from the person: no link is made for them. */
export const NO_ACTION = new Set(["booking_cancelled", "step_unassigned", "step_cancelled"]);

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (v: unknown) => (typeof v === "string" && isDateOnly(v) ? formatShort(v) : null);

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

export function renderMessage(m: MessageInput): RenderedMessage {
  const d = m.data;
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
    case "booking_reminder":
      sms = `Today: ${step} at ${unit}${str(d.time) ? ` at ${str(d.time)}` : ""}.${open}`;
      subject = `Today: ${step} at ${unit}`;
      break;
    case "booking_conflict":
      sms = `Heads-up: ${step} at ${unit} is booked for tomorrow (${day(d.on)}) but ${str(d.waitingOn) ?? "an earlier step"} isn't done yet.${open}`;
      subject = `Tomorrow's booking isn't ready: ${unit}, ${step}`;
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
    case "escalation":
      sms = `${unit}: ${step} has been with ${str(d.assigneeName) ?? "nobody"} for ${d.days} days${str(d.status) ? ` (${str(d.status)})` : ""}.${open}`;
      subject = `Taking too long: ${unit}, ${step}`;
      break;
    default:
      sms = `${unit}: ${step} changed.${open}`;
      subject = `${unit}: update`;
  }

  sms = plainText(sms);
  const text = plainText(`${sms.replace(` Open: ${m.link}`, "")}\n\n${m.link ? `Open it here: ${m.link}\n\n` : ""}Unit Turnover`);
  return { sms, subject: plainText(subject), text };
}

/** Hides the secret part of sign-in links, for messages kept in the outbox after they're sent. */
export function redactLinks(text: string): string {
  return text.replace(/\/l\/[A-Za-z0-9_-]{8,}/g, "/l/[link]");
}
