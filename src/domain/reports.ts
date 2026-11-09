/**
 * Reports: how long turns take and where they get stuck, for a period.
 *
 * - Days vacant and on-time use the sheet's rules: a turnover is rent-ready on
 *   its latest step date, and on time when that's on or before its target.
 * - Days per step is how long the unit sat at a step: from when it became that
 *   step's turn to when the step was done, added up over every round (a
 *   send-back starts another). It comes from the timeline, so steps finished
 *   before the app existed (imported from the sheet) aren't guessed at.
 * - Rework is the send-backs: how many, from which step, and whose work.
 *
 * Pure: the server loads the data (src/server/queries/reports.ts).
 */
import { addDays, type DateOnly, daysBetween, latestDate, toDayNumber, fromDayNumber, MONTHS_SHORT, weekday } from "./dates";
import { daysVacant as sheetDaysVacant } from "./derived";
import { isFinished, type StepStatus } from "./status";

export const REPORT_PERIODS = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
  year: "This year",
  all: "All time",
} as const;
export type ReportPeriod = keyof typeof REPORT_PERIODS;

export function parseReportPeriod(value: unknown): ReportPeriod {
  return typeof value === "string" && value in REPORT_PERIODS ? (value as ReportPeriod) : "90d";
}

/** The first and last day of a period, both included. */
export function periodRange(period: ReportPeriod, today: DateOnly, earliest: DateOnly | null): { from: DateOnly; to: DateOnly } {
  switch (period) {
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "12m":
      return { from: addDays(today, -364), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: earliest && earliest < today ? earliest : today, to: today };
  }
}

export interface ReportStep {
  id: string;
  name: string;
  status: StepStatus;
  assigneeId: string | null;
  completedOn: DateOnly | null;
  reopenedOn: DateOnly | null;
  dueOn: DateOnly | null;
  /** Days the unit sat at this step, over every round; null when the app didn't see it start. */
  daysAtStep: number | null;
}

export interface ReportTurnover {
  id: string;
  propertyId: string;
  property: string;
  unit: string;
  moveOutDate: DateOnly | null;
  targetReadyDate: DateOnly | null;
  /** In workflow order. */
  steps: ReportStep[];
}

export interface ReportSendBack {
  turnoverId: string;
  on: DateOnly;
  fromStep: string;
  toStep: string;
  /** Whoever had the step that has to be done again. */
  toAssigneeId: string | null;
}

export interface ReportInput {
  from: DateOnly;
  to: DateOnly;
  turnovers: readonly ReportTurnover[];
  sendBacks: readonly ReportSendBack[];
  people: ReadonlyMap<string, string>;
}

export interface CompletedTurnover {
  id: string;
  label: string;
  propertyId: string;
  property: string;
  moveOutDate: DateOnly | null;
  targetReadyDate: DateOnly | null;
  readyOn: DateOnly;
  daysVacant: number | null;
  onTime: boolean | null;
  sendBacks: number;
  /** Days at each step, by step name. */
  stepDays: Record<string, number | null>;
}

export interface StepSummary {
  name: string;
  /** Steps finished in the period with a known length. */
  count: number;
  avgDays: number;
  medianDays: number;
  longest: { label: string; days: number };
}

export interface PropertySummary {
  propertyId: string;
  property: string;
  completed: number;
  avgDaysVacant: number | null;
  onTimeRate: number | null;
  /** Average days at each step, by step name. */
  stepAvg: Record<string, number | null>;
  slowestStep: string | null;
}

export interface PersonSummary {
  personId: string;
  name: string;
  stepsDone: number;
  avgDays: number | null;
  /** Finished on or before their due date. */
  onTimeRate: number | null;
  /** Times their finished work was sent back to them. */
  sentBack: number;
}

export interface TrendPoint {
  start: DateOnly;
  label: string;
  completed: number;
  avgDaysVacant: number | null;
  onTimeRate: number | null;
}

export interface Report {
  from: DateOnly;
  to: DateOnly;
  stepNames: string[];
  completed: CompletedTurnover[];
  totals: {
    completed: number;
    avgDaysVacant: number | null;
    medianDaysVacant: number | null;
    onTime: number;
    withTarget: number;
    onTimeRate: number | null;
    sendBacks: number;
    /** Share of the turnovers completed in the period that were sent back at least once. */
    reworkRate: number | null;
  };
  steps: StepSummary[];
  bottleneck: string | null;
  byProperty: PropertySummary[];
  byPerson: PersonSummary[];
  trend: { unit: "week" | "month"; points: TrendPoint[] };
  rework: { byToStep: Array<{ step: string; count: number }>; byFromStep: Array<{ step: string; count: number }> };
}

const DAY_MS = 86_400_000;

export const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const rate = (yes: number, total: number) => (total ? yes / total : null);

export interface StepEvent {
  stepId: string | null;
  type: string;
  at: Date;
}

/**
 * Days each step was someone's turn, from the timeline: from each
 * "became their turn" to the "done" that follows, added up. Time before the
 * step sent the unit back counts too (it was there, being checked). A step
 * skipped as N/A, or one that was already under way when the app started
 * tracking it, gets no time.
 */
export function stepDurations(events: readonly StepEvent[]): Map<string, number> {
  const open = new Map<string, number>();
  const total = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (!e.stepId) continue;
    if (e.type === "step_activated") open.set(e.stepId, e.at.getTime());
    // Done, or sent the unit back (the sending step waits for the work to be redone).
    else if (e.type === "step_completed" || e.type === "sent_back" || e.type === "step_reset") {
      const start = open.get(e.stepId);
      if (start === undefined) continue;
      total.set(e.stepId, (total.get(e.stepId) ?? 0) + (e.at.getTime() - start) / DAY_MS);
      open.delete(e.stepId);
    } else if (e.type === "step_skipped" || e.type === "step_reopened") open.delete(e.stepId);
  }
  return total;
}

/** The day a finished turnover became rent-ready: its latest step date (the sheet's rule). */
export function readyOn(t: Pick<ReportTurnover, "steps">): DateOnly | null {
  if (!t.steps.every((s) => isFinished(s.status))) return null;
  return latestDate(t.steps.flatMap((s) => [s.completedOn, s.reopenedOn]));
}

function trendBuckets(from: DateOnly, to: DateOnly): { unit: "week" | "month"; starts: DateOnly[] } {
  if (daysBetween(to, from) <= 92) {
    // Weeks start on Monday.
    const first = addDays(from, -((weekday(from) + 6) % 7));
    const starts: DateOnly[] = [];
    for (let d = first; d <= to; d = addDays(d, 7)) starts.push(d);
    return { unit: "week", starts };
  }
  const starts: DateOnly[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    if (start > to) break;
    starts.push(start);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return { unit: "month", starts };
}

function bucketLabel(start: DateOnly, unit: "week" | "month", from: DateOnly, to: DateOnly): string {
  const [y, m, d] = start.split("-").map(Number);
  // Weeks are named by their Monday; months by name, with the year when the period spans two.
  if (unit === "week") return `${MONTHS_SHORT[m - 1]} ${d}`;
  return from.slice(0, 4) === to.slice(0, 4) ? MONTHS_SHORT[m - 1] : `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

export function buildReport(input: ReportInput): Report {
  const { from, to } = input;
  const inPeriod = (d: DateOnly | null): d is DateOnly => d !== null && d >= from && d <= to;
  const label = (t: ReportTurnover) => `${t.property} ${t.unit}`;

  // Step names in workflow order, as first seen.
  const stepNames: string[] = [];
  for (const t of input.turnovers) for (const s of t.steps) if (!stepNames.includes(s.name)) stepNames.push(s.name);

  const sendBacksByTurnover = new Map<string, number>();
  for (const sb of input.sendBacks) sendBacksByTurnover.set(sb.turnoverId, (sendBacksByTurnover.get(sb.turnoverId) ?? 0) + 1);
  const sendBacksInPeriod = input.sendBacks.filter((sb) => inPeriod(sb.on));

  // Turnovers that became rent-ready in the period.
  const completed: CompletedTurnover[] = [];
  for (const t of input.turnovers) {
    const ready = readyOn(t);
    if (!inPeriod(ready)) continue;
    const stepDates = t.steps.flatMap((s) => [s.completedOn, s.reopenedOn]);
    completed.push({
      id: t.id,
      label: label(t),
      propertyId: t.propertyId,
      property: t.property,
      moveOutDate: t.moveOutDate,
      targetReadyDate: t.targetReadyDate,
      readyOn: ready,
      daysVacant: sheetDaysVacant({ moveOutDate: t.moveOutDate, targetReadyDate: t.targetReadyDate, steps: [], stepDates }, true, ready),
      onTime: t.targetReadyDate ? ready <= t.targetReadyDate : null,
      sendBacks: sendBacksByTurnover.get(t.id) ?? 0,
      stepDays: Object.fromEntries(t.steps.map((s) => [s.name, s.status === "done" ? s.daysAtStep : null])),
    });
  }
  completed.sort((a, b) => (a.readyOn === b.readyOn ? a.label.localeCompare(b.label, undefined, { numeric: true }) : a.readyOn < b.readyOn ? -1 : 1));

  // Steps finished in the period, with how long each took.
  const finished = input.turnovers.flatMap((t) =>
    t.steps.filter((s) => s.status === "done" && inPeriod(s.completedOn)).map((s) => ({ t, s, days: s.daysAtStep })),
  );

  const steps: StepSummary[] = [];
  for (const name of stepNames) {
    const timed = finished.filter((f) => f.s.name === name && f.days !== null) as Array<{ t: ReportTurnover; s: ReportStep; days: number }>;
    if (timed.length === 0) continue;
    const longest = timed.reduce((a, b) => (b.days > a.days ? b : a));
    steps.push({
      name,
      count: timed.length,
      avgDays: mean(timed.map((f) => f.days))!,
      medianDays: median(timed.map((f) => f.days))!,
      longest: { label: label(longest.t), days: longest.days },
    });
  }
  const bottleneck = steps.length ? steps.reduce((a, b) => (b.avgDays > a.avgDays ? b : a)).name : null;

  // By property.
  const propertyIds = new Map<string, string>();
  for (const t of input.turnovers) propertyIds.set(t.propertyId, t.property);
  const byProperty: PropertySummary[] = [];
  for (const [propertyId, property] of propertyIds) {
    const done = completed.filter((c) => c.propertyId === propertyId);
    const own = finished.filter((f) => f.t.propertyId === propertyId);
    if (done.length === 0 && own.length === 0) continue;
    const stepAvg: Record<string, number | null> = {};
    for (const name of stepNames) stepAvg[name] = mean(own.filter((f) => f.s.name === name && f.days !== null).map((f) => f.days!));
    const timedSteps = Object.entries(stepAvg).filter((e): e is [string, number] => e[1] !== null);
    const withTarget = done.filter((c) => c.onTime !== null);
    byProperty.push({
      propertyId,
      property,
      completed: done.length,
      avgDaysVacant: mean(done.map((c) => c.daysVacant).filter((d): d is number => d !== null)),
      onTimeRate: rate(withTarget.filter((c) => c.onTime).length, withTarget.length),
      stepAvg,
      slowestStep: timedSteps.length ? timedSteps.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null,
    });
  }

  // By person: the steps they finished, and their work that came back.
  const people = new Map<string, { done: number; days: number[]; due: number; onTime: number; sentBack: number }>();
  const personRow = (id: string) => {
    if (!people.has(id)) people.set(id, { done: 0, days: [], due: 0, onTime: 0, sentBack: 0 });
    return people.get(id)!;
  };
  for (const f of finished) {
    if (!f.s.assigneeId) continue;
    const row = personRow(f.s.assigneeId);
    row.done += 1;
    if (f.days !== null) row.days.push(f.days);
    if (f.s.dueOn) {
      row.due += 1;
      if (f.s.completedOn! <= f.s.dueOn) row.onTime += 1;
    }
  }
  for (const sb of sendBacksInPeriod) if (sb.toAssigneeId) personRow(sb.toAssigneeId).sentBack += 1;
  const byPerson: PersonSummary[] = [...people.entries()]
    .map(([personId, r]) => ({
      personId,
      name: input.people.get(personId) ?? "Someone",
      stepsDone: r.done,
      avgDays: mean(r.days),
      onTimeRate: rate(r.onTime, r.due),
      sentBack: r.sentBack,
    }))
    .sort((a, b) => b.stepsDone - a.stepsDone || a.name.localeCompare(b.name));

  // Trend: turnovers completed per week or month.
  const { unit, starts } = trendBuckets(from, to);
  const bucketOf = (d: DateOnly) => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > d) i -= 1;
    return i;
  };
  const buckets = starts.map(() => [] as CompletedTurnover[]);
  for (const c of completed) buckets[bucketOf(c.readyOn)]?.push(c);
  const points: TrendPoint[] = starts.map((start, i) => {
    const group = buckets[i];
    const withTarget = group.filter((c) => c.onTime !== null);
    return {
      start,
      label: bucketLabel(start, unit, from, to),
      completed: group.length,
      avgDaysVacant: mean(group.map((c) => c.daysVacant).filter((d): d is number => d !== null)),
      onTimeRate: rate(withTarget.filter((c) => c.onTime).length, withTarget.length),
    };
  });

  const countBy = (key: "toStep" | "fromStep") => {
    const counts = new Map<string, number>();
    for (const sb of sendBacksInPeriod) counts.set(sb[key], (counts.get(sb[key]) ?? 0) + 1);
    return [...counts.entries()]
      .map(([step, count]) => ({ step, count }))
      .sort((a, b) => b.count - a.count || stepNames.indexOf(a.step) - stepNames.indexOf(b.step));
  };

  const vacancies = completed.map((c) => c.daysVacant).filter((d): d is number => d !== null);
  const withTarget = completed.filter((c) => c.onTime !== null);
  const onTime = withTarget.filter((c) => c.onTime).length;
  return {
    from,
    to,
    stepNames,
    completed,
    totals: {
      completed: completed.length,
      avgDaysVacant: mean(vacancies),
      medianDaysVacant: median(vacancies),
      onTime,
      withTarget: withTarget.length,
      onTimeRate: rate(onTime, withTarget.length),
      sendBacks: sendBacksInPeriod.length,
      reworkRate: rate(completed.filter((c) => c.sendBacks > 0).length, completed.length),
    },
    steps,
    bottleneck,
    byProperty: byProperty.sort((a, b) => b.completed - a.completed || a.property.localeCompare(b.property)),
    byPerson,
    trend: { unit, points },
    rework: { byToStep: countBy("toStep"), byFromStep: countBy("fromStep") },
  };
}

/** The earliest date in the data, for "All time". */
export function earliestDate(turnovers: readonly ReportTurnover[]): DateOnly | null {
  let earliest: number | null = null;
  for (const t of turnovers) {
    for (const d of [t.moveOutDate, ...t.steps.map((s) => s.completedOn)]) {
      if (d && (earliest === null || toDayNumber(d) < earliest)) earliest = toDayNumber(d);
    }
  }
  return earliest === null ? null : fromDayNumber(earliest);
}
