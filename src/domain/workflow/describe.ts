/**
 * Plain-English timeline entries for a turnover's events.
 */
import { formatShort, isDateOnly } from "../dates";

export interface TimelineEvent {
  id: number;
  type: string;
  stepName: string | null;
  actorId: string | null;
  data: Record<string, unknown>;
  at: Date;
}

export type Tone = "default" | "muted" | "success" | "warning" | "danger";

export interface TimelineEntry {
  key: string;
  at: Date;
  text: string;
  detail?: string;
  tone: Tone;
}

const quote = (v: unknown) => `“${String(v ?? "")}”`;
const day = (v: unknown) => (typeof v === "string" && isDateOnly(v) ? formatShort(v) : "no date");

const FIELD_NAMES: Record<string, string> = {
  moveOutDate: "move-out date",
  targetReadyDate: "target ready date",
  notes: "notes",
};

/** Newest first. Runs of ticked checklist items by the same person collapse into one entry. */
export function describeEvents(events: TimelineEvent[], nameOf: (personId: string | null) => string | null): TimelineEntry[] {
  const sorted = [...events].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id);
  const entries: TimelineEntry[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const who = nameOf(e.actorId) ?? "The system";
    const step = e.stepName ?? "the turnover";
    const d = e.data;
    const entry = (text: string, tone: Tone = "default", detail?: string): TimelineEntry => ({
      key: String(e.id),
      at: e.at,
      text,
      tone,
      detail: detail || undefined,
    });

    if (e.type === "checklist_item_updated" && d.to === "done") {
      const run = [e];
      while (
        i + 1 < sorted.length &&
        sorted[i + 1].type === "checklist_item_updated" &&
        sorted[i + 1].data.to === "done" &&
        sorted[i + 1].actorId === e.actorId &&
        sorted[i + 1].stepName === e.stepName
      ) {
        run.push(sorted[++i]);
      }
      const items = run.map((r) => String(r.data.text ?? "")).reverse();
      entries.push(
        run.length === 1
          ? entry(`${who} ticked off ${quote(items[0])} on ${step}`, "muted")
          : entry(`${who} ticked off ${run.length} items on ${step}`, "muted", items.join(" · ")),
      );
      continue;
    }

    switch (e.type) {
      case "turnover_created":
        entries.push(entry(`${who} created the turnover`));
        break;
      case "imported":
        entries.push(entry(`Imported from the sheet (row ${d.rowNumber})`, "muted", String(d.file ?? "")));
        break;
      case "step_activated":
        entries.push(entry(d.reason === "sent_back" ? `${step} reopened for rework` : `${step} is ready to start`, "muted"));
        break;
      case "step_started":
        entries.push(entry(`${who} started ${step}`));
        break;
      case "step_scheduled":
        entries.push(entry(`${who} booked ${step} for ${day(d.on)}${d.time ? ` at ${d.time}` : ""}${d.ahead ? ", ahead of time" : ""}`));
        break;
      case "step_unscheduled":
        entries.push(entry(`${who} cancelled the ${step} booking`));
        break;
      case "step_completed":
        entries.push(entry(`${who} marked ${step} Done`, "success", d.note as string | undefined));
        break;
      case "step_skipped":
        entries.push(
          d.automatic
            ? entry(`${step} skipped (N/A)`, "muted", d.reason as string)
            : entry(`${who} marked ${step} N/A`, "muted", d.reason as string | undefined),
        );
        break;
      case "step_blocked":
        entries.push(entry(`${who} blocked ${step}`, "danger", d.reason as string));
        break;
      case "step_unblocked":
        entries.push(entry(`${who} unblocked ${step}`, "default", (d.note as string | undefined) ?? (d.wasBlockedFor ? `Was waiting on: ${d.wasBlockedFor}` : undefined)));
        break;
      case "sent_back":
        entries.push(entry(`${who} sent the unit back from ${step} to ${d.toStepName}`, "warning", d.reason as string));
        break;
      case "step_reopened":
        entries.push(entry(`${step} reopened`, "muted"));
        break;
      case "step_reset":
        entries.push(entry(`${step} is waiting again`, "muted"));
        break;
      case "step_reassigned": {
        const to = nameOf((d.toPersonId as string) ?? null);
        entries.push(entry(to ? `${who} assigned ${step} to ${to}` : `${who} took ${step} off ${nameOf((d.fromPersonId as string) ?? null) ?? "its assignee"}`));
        break;
      }
      case "checklist_item_added":
        entries.push(entry(`${who} added ${quote(d.text)} to ${step}`, "muted"));
        break;
      case "checklist_item_updated": {
        const verb =
          d.to === "open" ? "unticked" : d.to === "to_confirm" ? "marked as to confirm:" : d.to === "dropped" ? "dropped" : "updated";
        entries.push(entry(`${who} ${verb} ${quote(d.text)} on ${step}`, "muted"));
        break;
      }
      case "checklist_item_edited":
        entries.push(entry(`${who} changed ${quote(d.from)} to ${quote(d.to)}`, "muted"));
        break;
      case "scope_applied":
        entries.push(entry(`${d.items} scope item${d.items === 1 ? "" : "s"} became ${step}'s checklist`, "muted"));
        break;
      case "note_added":
        entries.push(entry(e.stepName ? `${who} added a note on ${step}` : `${who} added a note`, "default", d.text as string));
        break;
      case "turnover_updated": {
        const changes = (d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
        const parts = Object.entries(changes).map(([field, c]) =>
          field === "notes"
            ? "Notes updated"
            : `${FIELD_NAMES[field] ?? field}: ${c.from ? day(c.from) : "blank"} → ${c.to ? day(c.to) : "blank"}`,
        );
        entries.push(entry(`${who} changed the ${Object.keys(changes).map((f) => FIELD_NAMES[f] ?? f).join(" and ")}`, "default", parts.join(" · ")));
        break;
      }
      case "turnover_completed":
        entries.push(entry("Complete: every step is Done or N/A", "success"));
        break;
      case "turnover_reopened":
        entries.push(entry("Reopened: a finished step has to be done again", "warning"));
        break;
      default:
        entries.push(entry(`${who}: ${e.type.replaceAll("_", " ")}`, "muted"));
    }
  }
  return entries;
}
