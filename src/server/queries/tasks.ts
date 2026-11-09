/**
 * What an assignee sees: their own tasks, and nothing else.
 *
 * - Active: it's their turn (every step before is Done or N/A).
 * - Upcoming: a later step a manager booked them for. They see the unit and
 *   the date, but not the access notes, and can't act on it yet.
 * - Everything else (waiting steps nobody booked, other people's steps,
 *   finished steps) isn't shown at all.
 */
import { and, asc, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { checklistItems, events, people, properties, turnovers, turnoverSteps } from "@/db/schema";
import { getSettings } from "@/db/settings";
import { type DateOnly, dateInZone, daysBetween } from "@/domain/dates";
import { derive, type Flag } from "@/domain/derived";
import { isFinished } from "@/domain/status";
import { describeEvents, type TimelineEntry } from "@/domain/workflow/describe";
import { isStepActive, isStepUpcomingBooking, turnoverDerivedInput } from "@/domain/workflow/engine";
import type { StepState, TurnoverState } from "@/domain/workflow/types";
import { type Attachment, listAttachments } from "../files/attachments";
import { type Finding, listFindings } from "../findings";
import { toTurnoverState } from "../turnover-store";

export interface TaskSummary {
  stepId: string;
  turnoverId: string;
  propertyName: string;
  address: string | null;
  unit: string;
  stepName: string;
  stepNumber: number;
  kind: StepState["kind"];
  status: StepState["status"];
  state: "active" | "upcoming";
  dueOn: DateOnly | null;
  late: boolean;
  scheduledOn: DateOnly | null;
  scheduledTime: string | null;
  bookingPassed: boolean;
  bookedToday: boolean;
  blockedReason: string | null;
  openItems: number;
  totalItems: number;
  reworkCount: number;
}

async function loadAssigned(ex: Executor, personId: string, alsoStepId?: string) {
  const mine = await ex
    .select({ turnoverId: turnoverSteps.turnoverId })
    .from(turnoverSteps)
    .where(and(eq(turnoverSteps.assigneeId, personId), notInArray(turnoverSteps.status, ["done", "na"])));
  const ids = [...new Set(mine.map((m) => m.turnoverId))];
  if (alsoStepId) {
    const [s] = await ex.select({ turnoverId: turnoverSteps.turnoverId }).from(turnoverSteps).where(eq(turnoverSteps.id, alsoStepId));
    if (s && !ids.includes(s.turnoverId)) ids.push(s.turnoverId);
  }
  if (ids.length === 0) return [];
  const [rows, steps, items, props] = await Promise.all([
    ex.select().from(turnovers).where(and(inArray(turnovers.id, ids), isNull(turnovers.archivedAt))),
    ex.select().from(turnoverSteps).where(inArray(turnoverSteps.turnoverId, ids)).orderBy(asc(turnoverSteps.position)),
    ex
      .select({ item: checklistItems })
      .from(checklistItems)
      .innerJoin(turnoverSteps, eq(turnoverSteps.id, checklistItems.stepId))
      .where(inArray(turnoverSteps.turnoverId, ids))
      .orderBy(asc(checklistItems.position)),
    ex.select().from(properties),
  ]);
  const propertyById = new Map(props.map((p) => [p.id, p]));
  return rows.map((row) => ({
    turnover: toTurnoverState(
      row,
      steps.filter((s) => s.turnoverId === row.id),
      items.map((i) => i.item),
    ),
    property: propertyById.get(row.propertyId)!,
  }));
}

function summarize(t: TurnoverState, property: { name: string; address: string | null }, index: number, today: DateOnly): TaskSummary {
  const s = t.steps[index];
  const active = isStepActive(t.steps, index);
  const countable = s.checklist.filter((c) => c.state === "open" || c.state === "done");
  return {
    stepId: s.id,
    turnoverId: t.id,
    propertyName: property.name,
    address: property.address,
    unit: t.unit,
    stepName: s.name,
    stepNumber: index + 1,
    kind: s.kind,
    status: s.status,
    state: active ? "active" : "upcoming",
    dueOn: s.dueOn,
    late: active && s.dueOn !== null && daysBetween(today, s.dueOn) > 0,
    scheduledOn: s.scheduledOn,
    scheduledTime: s.scheduledTime,
    bookingPassed: s.status === "scheduled" && s.scheduledOn !== null && daysBetween(today, s.scheduledOn) > 0,
    bookedToday: s.scheduledOn === today,
    blockedReason: s.status === "blocked" ? s.blockedReason : null,
    openItems: countable.filter((c) => c.state === "open").length,
    totalItems: countable.length,
    reworkCount: s.reworkCount,
  };
}

/** Most pressing first: blocked, then late or a booking that has passed, then booked today, then by due date. */
function urgency(t: TaskSummary): number {
  if (t.status === "blocked") return 0;
  if (t.late || t.bookingPassed) return 1;
  if (t.bookedToday) return 2;
  return 3;
}

export async function listMyTasks(ex: Executor, personId: string, now = new Date()) {
  const settings = await getSettings(ex);
  const today = dateInZone(now, settings.timezone);
  const loaded = await loadAssigned(ex, personId);
  const active: TaskSummary[] = [];
  const upcoming: TaskSummary[] = [];
  for (const { turnover: t, property } of loaded) {
    t.steps.forEach((s, i) => {
      if (s.assigneeId !== personId || isFinished(s.status)) return;
      if (isStepActive(t.steps, i)) active.push(summarize(t, property, i, today));
      else if (isStepUpcomingBooking(t.steps, i)) upcoming.push(summarize(t, property, i, today));
    });
  }
  active.sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      (a.scheduledOn ?? a.dueOn ?? "9999").localeCompare(b.scheduledOn ?? b.dueOn ?? "9999") ||
      a.propertyName.localeCompare(b.propertyName) ||
      a.unit.localeCompare(b.unit, undefined, { numeric: true }),
  );
  upcoming.sort(
    (a, b) =>
      (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? "") ||
      a.propertyName.localeCompare(b.propertyName) ||
      a.unit.localeCompare(b.unit, undefined, { numeric: true }),
  );

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const finished = await ex
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.actorId, personId), eq(events.type, "step_completed"), gte(events.at, weekAgo)));
  return { today, active, upcoming, doneThisWeek: finished.length };
}

export interface TaskDetail {
  today: DateOnly;
  summary: TaskSummary;
  step: StepState;
  turnover: TurnoverState;
  property: { name: string; address: string | null; accessNotes: string | null };
  flag: Flag;
  daysVacant: number | null;
  /** Earlier finished steps this unit could be sent back to. */
  sendBackTargets: Array<{ id: string; name: string }>;
  findings: Finding[];
  /** Photos, files and links on the unit, by step (active tasks only). */
  attachments: Attachment[];
  stepNames: Map<string, string>;
  recent: TimelineEntry[];
}

/** One of this person's tasks, or null if it isn't theirs (or isn't theirs yet). */
export async function getTaskDetail(ex: Executor, personId: string, stepId: string, now = new Date()): Promise<TaskDetail | null> {
  const settings = await getSettings(ex);
  const today = dateInZone(now, settings.timezone);
  const loaded = await loadAssigned(ex, personId, stepId);
  for (const { turnover: t, property } of loaded) {
    const index = t.steps.findIndex((s) => s.id === stepId);
    if (index === -1) continue;
    const step = t.steps[index];
    if (step.assigneeId !== personId) return null;
    const active = isStepActive(t.steps, index);
    if (!active && !isStepUpcomingBooking(t.steps, index)) return null;

    const derived = derive(turnoverDerivedInput(t), today, settings.dueSoonDays);
    const [findings, files, recentEvents] = await Promise.all([
      step.kind === "inspection" ? listFindings(ex, [step.id]) : Promise.resolve([]),
      active ? listAttachments(ex, t.id) : Promise.resolve([]),
      active
        ? ex
            .select({ id: events.id, type: events.type, actorId: events.actorId, data: events.data, at: events.at, stepName: turnoverSteps.name })
            .from(events)
            .leftJoin(turnoverSteps, eq(turnoverSteps.id, events.stepId))
            .where(and(eq(events.turnoverId, t.id), inArray(events.type, ["note_added", "sent_back", "step_blocked", "step_unblocked", "step_completed"])))
            .orderBy(desc(events.id))
            .limit(12)
        : Promise.resolve([]),
    ]);
    const actorIds = [...new Set(recentEvents.map((e) => e.actorId).filter((a): a is string => !!a))];
    const names = new Map(
      actorIds.length ? (await ex.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, actorIds))).map((p) => [p.id, p.name]) : [],
    );
    return {
      today,
      summary: summarize(t, property, index, today),
      step,
      turnover: t,
      // Lockbox codes and keys only for whoever's turn it is.
      property: { name: property.name, address: property.address, accessNotes: active ? property.accessNotes : null },
      flag: derived.flag,
      daysVacant: derived.daysVacant,
      sendBackTargets: active ? t.steps.slice(0, index).filter((s) => isFinished(s.status)).map((s) => ({ id: s.id, name: s.name })) : [],
      findings,
      attachments: files,
      stepNames: new Map(t.steps.map((s) => [s.id, s.name])),
      recent: describeEvents(recentEvents, (id) => (id ? (names.get(id) ?? null) : null)),
    };
  }
  return null;
}
