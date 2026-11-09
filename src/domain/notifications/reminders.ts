/**
 * The morning run: what each person hears about at the start of the day.
 *
 * - People on steps get one message listing what's on: bookings today, tasks
 *   due today, tasks that went past their due date yesterday, and bookings
 *   from yesterday that nobody marked done.
 * - Managers get the morning summary by email. It also goes by text when
 *   something needs them: a booking today or tomorrow whose unit isn't ready,
 *   or a step nobody has updated for longer than its "alert me after" days.
 *
 * Each reminder is sent once, on the morning it first applies, so nobody hears
 * about the same thing every day. The summary lists everything still open.
 *
 * Pure: the server gathers the turnovers and runs this once a day.
 */
import { addDays, type DateOnly, dateInZone, daysBetween } from "../dates";
import type { Derived } from "../derived";
import { isFinished, STATUS_LABELS } from "../status";
import { isStepReady, stepGroups } from "../workflow/engine";
import type { Role, StepState, TurnoverState } from "../workflow/types";

export interface MorningTurnover {
  turnover: TurnoverState;
  /** "Acadian 203". */
  label: string;
  derived: Pick<Derived, "currentStage" | "isComplete" | "daysVacant" | "flag">;
  pastTarget: boolean;
  /** When anyone last did anything on each step (its latest timeline entry). */
  lastActivity: ReadonlyMap<string, Date>;
}

export interface MorningPerson {
  id: string;
  name: string;
  roles: readonly Role[];
  active: boolean;
}

export interface MorningInput {
  today: DateOnly;
  timeZone: string;
  turnovers: readonly MorningTurnover[];
  people: ReadonlyMap<string, MorningPerson>;
}

export interface StepRef {
  turnoverId: string;
  stepId: string;
  /** "Acadian 203". */
  unit: string;
  stepName: string;
}

/** One line of someone's morning message. */
export type TaskReminder = StepRef &
  (
    | { type: "booking"; time: string | null }
    | { type: "due" }
    | { type: "late"; dueOn: DateOnly }
    | { type: "missed"; on: DateOnly }
  );

/** Something new that needs a manager this morning (sent by text as well). */
export type Attention = StepRef &
  (
    | { type: "not_ready"; on: DateOnly; when: "today" | "tomorrow"; waitingOn: string; assigneeName: string | null }
    | { type: "stalled"; since: DateOnly; assigneeName: string | null; status: string }
  );

export interface Digest {
  day: DateOnly;
  counts: { active: number; blocked: number; pastTarget: number; dueSoon: number; unassigned: number };
  /** New this morning. */
  attention: Attention[];
  blocked: Array<StepRef & { assigneeName: string | null; reason: string | null; since: DateOnly | null }>;
  unassigned: Array<StepRef & { since: DateOnly | null }>;
  pastTarget: Array<{ turnoverId: string; unit: string; target: DateOnly | null; stage: string }>;
  dueSoon: Array<{ turnoverId: string; unit: string; target: DateOnly | null; stage: string }>;
  /** Assigned, unblocked steps with no updates for longer than their limit. */
  stalled: Array<StepRef & { since: DateOnly; assigneeName: string | null; status: string }>;
  lateTasks: Array<StepRef & { assigneeName: string | null; dueOn: DateOnly }>;
  bookedToday: Array<StepRef & { assigneeName: string | null; time: string | null; waitingOn: string | null }>;
  doneYesterday: Array<StepRef & { assigneeName: string | null }>;
  completedYesterday: Array<{ turnoverId: string; unit: string; daysVacant: number | null }>;
}

export interface MorningMessage {
  recipientId: string;
  kind: "daily_tasks" | "daily_digest";
  turnoverId: string | null;
  stepId: string | null;
  data: Record<string, unknown>;
  dedupeKey: string;
}

/** The first unfinished step this one is waiting for. */
export function waitingOn(steps: readonly StepState[], index: number): string | null {
  const groups = stepGroups(steps);
  return steps.find((s, i) => groups[i] < groups[index] && !isFinished(s.status))?.name ?? null;
}

/**
 * The day of the step's last update: when it became someone's turn, anything
 * done on it since, or its booking date (a booked step isn't late before then).
 */
export function lastUpdateOn(step: StepState, lastActivity: Date | null, timeZone: string): DateOnly | null {
  const dates = [step.activatedAt, lastActivity].filter((d): d is Date => d !== null).map((d) => dateInZone(d, timeZone));
  if (step.status === "scheduled" && step.scheduledOn) dates.push(step.scheduledOn);
  return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b));
}

/** Whole days with no updates, not counting the day of the last update or today. */
export function quietDays(since: DateOnly, today: DateOnly): number {
  return Math.max(0, daysBetween(today, since) - 1);
}

export function collectMorning(input: MorningInput): { tasks: Map<string, TaskReminder[]>; digest: Digest } {
  const { today, timeZone } = input;
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const nameOf = (id: string | null) => (id ? (input.people.get(id)?.name ?? null) : null);
  const tasks = new Map<string, TaskReminder[]>();
  const remind = (personId: string, item: TaskReminder) => tasks.set(personId, [...(tasks.get(personId) ?? []), item]);

  const digest: Digest = {
    day: today,
    counts: { active: 0, blocked: 0, pastTarget: 0, dueSoon: 0, unassigned: 0 },
    attention: [],
    blocked: [],
    unassigned: [],
    pastTarget: [],
    dueSoon: [],
    stalled: [],
    lateTasks: [],
    bookedToday: [],
    doneYesterday: [],
    completedYesterday: [],
  };

  for (const view of input.turnovers) {
    const t = view.turnover;
    if (view.derived.isComplete) {
      if (t.completedAt && dateInZone(t.completedAt, timeZone) === yesterday) {
        digest.completedYesterday.push({ turnoverId: t.id, unit: view.label, daysVacant: view.derived.daysVacant });
      }
    } else {
      digest.counts.active += 1;
      const line = { turnoverId: t.id, unit: view.label, target: t.targetReadyDate, stage: view.derived.currentStage };
      if (view.pastTarget) digest.pastTarget.push(line);
      else if (view.derived.flag === "Due soon") digest.dueSoon.push(line);
    }

    t.steps.forEach((s, i) => {
      const ref: StepRef = { turnoverId: t.id, stepId: s.id, unit: view.label, stepName: s.name };
      const assigneeName = nameOf(s.assigneeId);
      if (s.status === "done" && s.completedOn === yesterday) digest.doneYesterday.push({ ...ref, assigneeName });
      if (isFinished(s.status)) return;

      const ready = isStepReady(t.steps, i);
      if (s.status === "blocked") {
        digest.blocked.push({ ...ref, assigneeName, reason: s.blockedReason, since: s.blockedAt ? dateInZone(s.blockedAt, timeZone) : null });
      }
      if (s.status === "scheduled" && s.scheduledOn) {
        const waiting = ready ? null : (waitingOn(t.steps, i) ?? "an earlier step");
        if (s.scheduledOn === today) digest.bookedToday.push({ ...ref, assigneeName, time: s.scheduledTime, waitingOn: waiting });
        if (waiting && (s.scheduledOn === today || s.scheduledOn === tomorrow)) {
          digest.attention.push({
            ...ref,
            type: "not_ready",
            on: s.scheduledOn,
            when: s.scheduledOn === today ? "today" : "tomorrow",
            waitingOn: waiting,
            assigneeName,
          });
        }
      }
      // Everything below is about steps whose turn it is.
      if (!ready) return;

      if (!s.assigneeId) digest.unassigned.push({ ...ref, since: s.activatedAt ? dateInZone(s.activatedAt, timeZone) : null });

      const since = lastUpdateOn(s, view.lastActivity.get(s.id) ?? null, timeZone);
      if (since && s.escalateAfterDays !== null) {
        const quiet = quietDays(since, today);
        if (quiet >= s.escalateAfterDays && quiet > 0) {
          const stalled = { ...ref, since, assigneeName, status: STATUS_LABELS[s.status] };
          if (quiet === Math.max(1, s.escalateAfterDays)) digest.attention.push({ ...stalled, type: "stalled" });
          // Blocked and unassigned steps have their own lists.
          if (s.status !== "blocked" && s.assigneeId) digest.stalled.push(stalled);
        }
      }

      const working = s.status === "not_started" || s.status === "in_progress";
      if (working && s.dueOn && s.dueOn < today) digest.lateTasks.push({ ...ref, assigneeName, dueOn: s.dueOn });

      if (!s.assigneeId) return;
      if (s.status === "scheduled" && s.scheduledOn === today) remind(s.assigneeId, { ...ref, type: "booking", time: s.scheduledTime });
      if (s.status === "scheduled" && s.scheduledOn === yesterday) remind(s.assigneeId, { ...ref, type: "missed", on: s.scheduledOn });
      // Someone who got the task this morning already knows it's due today.
      const activatedEarlier = s.activatedAt !== null && dateInZone(s.activatedAt, timeZone) < today;
      if (working && s.dueOn === today && activatedEarlier) remind(s.assigneeId, { ...ref, type: "due" });
      if (working && s.dueOn === yesterday) remind(s.assigneeId, { ...ref, type: "late", dueOn: s.dueOn });
    });
  }

  digest.attention.sort((a, b) => (a.type === b.type ? 0 : a.type === "not_ready" ? -1 : 1));
  digest.counts.blocked = digest.blocked.length;
  digest.counts.pastTarget = digest.pastTarget.length;
  digest.counts.dueSoon = digest.dueSoon.length;
  digest.counts.unassigned = digest.unassigned.length;
  return { tasks, digest };
}

/** Is there anything worth a morning summary? */
export function digestHasNews(d: Digest): boolean {
  return d.counts.active > 0 || d.doneYesterday.length > 0 || d.completedYesterday.length > 0;
}

/** This morning's messages: one per person with something on today, and a summary for each manager. */
export function planMorning(input: MorningInput): MorningMessage[] {
  const { tasks, digest } = collectMorning(input);
  const messages: MorningMessage[] = [];

  for (const [personId, items] of tasks) {
    if (!input.people.get(personId)?.active) continue;
    const only = items.length === 1 ? items[0] : null;
    messages.push({
      recipientId: personId,
      kind: "daily_tasks",
      turnoverId: only?.turnoverId ?? null,
      stepId: only?.stepId ?? null,
      data: { day: input.today, items },
      dedupeKey: `daily_tasks:${input.today}:${personId}`,
    });
  }

  if (digestHasNews(digest)) {
    for (const person of input.people.values()) {
      if (!person.active || !person.roles.includes("admin")) continue;
      messages.push({
        recipientId: person.id,
        kind: "daily_digest",
        turnoverId: null,
        stepId: null,
        data: { ...digest, urgent: digest.attention.length > 0 },
        dedupeKey: `daily_digest:${input.today}:${person.id}`,
      });
    }
  }
  return messages;
}
