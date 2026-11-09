import { describe, expect, it } from "vitest";
import { addDays, type DateOnly } from "./dates";
import {
  buildReport,
  earliestDate,
  periodRange,
  type ReportInput,
  type ReportSendBack,
  type ReportStep,
  type ReportTurnover,
  stepDurations,
} from "./reports";

const STEPS = ["Inspection", "Scope of work", "In-house work", "Cleaning", "Photos", "Leasing upload"];
const NOV = { from: "2026-11-01", to: "2026-11-30" };
let ids = 0;

/** One finished step: when, how many days it took, and who did it. */
type Done = { on: DateOnly; days?: number | null; who?: string; due?: DateOnly | null; na?: boolean };

function turnover(
  unit: string,
  opts: { property?: string; moveOut?: DateOnly | null; target?: DateOnly | null; done?: Done[] } = {},
): ReportTurnover {
  const property = opts.property ?? "Acadian";
  const steps: ReportStep[] = STEPS.map((name, i) => {
    const d = opts.done?.[i];
    return {
      id: `step-${(ids += 1)}`,
      name,
      status: d ? (d.na ? "na" : "done") : i === (opts.done?.length ?? 0) ? "in_progress" : "not_started",
      assigneeId: d?.who ?? null,
      completedOn: d?.on ?? null,
      reopenedOn: null,
      dueOn: d?.due ?? null,
      daysAtStep: d && !d.na ? (d.days === undefined ? 1 : d.days) : null,
    };
  });
  return {
    id: `t-${unit}`,
    propertyId: `p-${property}`,
    property,
    unit,
    moveOutDate: opts.moveOut === undefined ? "2026-11-01" : opts.moveOut,
    targetReadyDate: opts.target === undefined ? "2026-11-12" : opts.target,
    steps,
  };
}

/** Every step done, the last on `ready` (the others the days before). */
const finished = (unit: string, ready: DateOnly, opts: Parameters<typeof turnover>[1] = {}, days: number[] = [1, 1, 3, 1, 1, 1]) =>
  turnover(unit, { ...opts, done: STEPS.map((_, i) => ({ on: addDays(ready, i - 5), days: days[i] })) });

const report = (turnovers: ReportTurnover[], extra: Partial<ReportInput> = {}) =>
  buildReport({ ...NOV, turnovers, sendBacks: [], people: new Map([["crew-a", "Crew A"], ["crew-b", "Crew B"], ["cleaner", "Cleaner A"]]), ...extra });

describe("reports", () => {
  it("measures days vacant and on-time the way the sheet does", () => {
    const r = report([
      finished("101", "2026-11-10", { moveOut: "2026-11-01", target: "2026-11-12" }), // 9 days, on time
      finished("102", "2026-11-05", { moveOut: "2026-10-20", target: "2026-11-01" }), // 16 days, late
      finished("103", "2026-11-12", { moveOut: "2026-11-02", target: null }), // 10 days, no target
      finished("104", "2026-09-30", { moveOut: "2026-09-20" }), // before the period
      turnover("105", { done: [{ on: "2026-11-03" }] }), // still in progress
    ]);
    expect(r.completed.map((c) => [c.label, c.readyOn, c.daysVacant, c.onTime])).toEqual([
      ["Acadian 102", "2026-11-05", 16, false],
      ["Acadian 101", "2026-11-10", 9, true],
      ["Acadian 103", "2026-11-12", 10, null],
    ]);
    expect(r.totals).toMatchObject({ completed: 3, avgDaysVacant: 35 / 3, medianDaysVacant: 10, onTime: 1, withTarget: 2, onTimeRate: 0.5 });
  });

  it("finds the slowest step from how long each one took", () => {
    const r = report([
      finished("101", "2026-11-10", {}, [1, 0.5, 4, 1, 2, 0.5]),
      finished("102", "2026-11-11", {}, [2, 0.5, 6, 1, 1, 0.5]),
      // Imported from the sheet: the app never saw these steps start.
      turnover("103", { done: STEPS.map(() => ({ on: "2026-11-04", days: null })) }),
      // Skipped as N/A: not part of the average.
      turnover("104", { done: [{ on: "2026-11-03" }, { on: "2026-11-03" }, { on: "2026-11-03", na: true }] }),
    ]);
    expect(r.steps.map((s) => [s.name, s.count, s.avgDays])).toEqual([
      ["Inspection", 3, 4 / 3],
      ["Scope of work", 3, 2 / 3],
      ["In-house work", 2, 5],
      ["Cleaning", 2, 1],
      ["Photos", 2, 1.5],
      ["Leasing upload", 2, 0.5],
    ]);
    expect(r.bottleneck).toBe("In-house work");
    expect(r.steps[2].longest).toEqual({ label: "Acadian 102", days: 6 });
  });

  it("compares properties side by side", () => {
    const r = report([
      finished("101", "2026-11-10", { property: "Acadian" }, [1, 1, 2, 1, 1, 1]),
      finished("1", "2026-11-20", { property: "Balwin", moveOut: "2026-11-01", target: "2026-11-15" }, [1, 1, 1, 5, 1, 1]),
    ]);
    expect(r.byProperty.map((p) => [p.property, p.completed, p.avgDaysVacant, p.onTimeRate, p.slowestStep])).toEqual([
      ["Acadian", 1, 9, 1, "In-house work"],
      ["Balwin", 1, 19, 0, "Cleaning"],
    ]);
    expect(r.byProperty[1].stepAvg).toMatchObject({ Cleaning: 5, "In-house work": 1 });
  });

  it("shows each person's finished steps, whether they met their due dates, and work that came back", () => {
    const t = turnover("101", {
      done: [
        { on: "2026-11-03", days: 2, who: "crew-a", due: "2026-11-03" },
        { on: "2026-11-04", days: 1, who: "crew-a", due: "2026-11-02" },
        { on: "2026-11-09", days: 4, who: "crew-b", due: "2026-11-10" },
      ],
    });
    const sendBacks: ReportSendBack[] = [{ turnoverId: t.id, on: "2026-11-08", fromStep: "Cleaning", toStep: "In-house work", toAssigneeId: "crew-b" }];
    const r = report([t], { sendBacks });
    expect(r.byPerson).toEqual([
      { personId: "crew-a", name: "Crew A", stepsDone: 2, avgDays: 1.5, onTimeRate: 0.5, sentBack: 0 },
      { personId: "crew-b", name: "Crew B", stepsDone: 1, avgDays: 4, onTimeRate: 1, sentBack: 1 },
    ]);
  });

  it("counts send-backs, and the share of finished turns that needed rework", () => {
    const a = finished("101", "2026-11-10");
    const b = finished("102", "2026-11-12");
    const sendBacks: ReportSendBack[] = [
      { turnoverId: a.id, on: "2026-11-06", fromStep: "Photos", toStep: "In-house work", toAssigneeId: null },
      { turnoverId: a.id, on: "2026-11-08", fromStep: "Photos", toStep: "Cleaning", toAssigneeId: null },
      { turnoverId: b.id, on: "2026-10-28", fromStep: "Cleaning", toStep: "In-house work", toAssigneeId: null }, // before the period
    ];
    const r = report([a, b], { sendBacks });
    expect(r.totals.sendBacks).toBe(2);
    expect(r.totals.reworkRate).toBe(1); // both were sent back at some point
    expect(r.completed.map((c) => c.sendBacks)).toEqual([2, 1]);
    expect(r.rework.byToStep).toEqual([
      { step: "In-house work", count: 1 },
      { step: "Cleaning", count: 1 },
    ]);
    expect(r.rework.byFromStep).toEqual([{ step: "Photos", count: 2 }]);
  });

  it("trends by week for short periods and by month for long ones", () => {
    const turnovers = [finished("101", "2026-11-03"), finished("102", "2026-11-04"), finished("103", "2026-11-17", { moveOut: "2026-11-01" })];
    const weekly = report(turnovers).trend;
    expect(weekly.unit).toBe("week");
    expect(weekly.points.map((p) => [p.start, p.label, p.completed])).toEqual([
      ["2026-10-26", "Oct 26", 0],
      ["2026-11-02", "Nov 2", 2],
      ["2026-11-09", "Nov 9", 0],
      ["2026-11-16", "Nov 16", 1],
      ["2026-11-23", "Nov 23", 0],
      ["2026-11-30", "Nov 30", 0],
    ]);
    expect(weekly.points[3].avgDaysVacant).toBe(16);

    const monthly = report(turnovers, { from: "2025-11-10", to: "2026-11-09" }).trend;
    expect(monthly.unit).toBe("month");
    expect(monthly.points.map((p) => p.label)).toEqual(["Nov 25", "Dec 25", "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26", "Jul 26", "Aug 26", "Sep 26", "Oct 26", "Nov 26"]);
    expect(monthly.points.at(-1)!.completed).toBe(2); // Nov 17 is after the period
  });

  it("has nothing to say about an empty period, without falling over", () => {
    const r = report([]);
    expect(r.totals).toEqual({ completed: 0, avgDaysVacant: null, medianDaysVacant: null, onTime: 0, withTarget: 0, onTimeRate: null, sendBacks: 0, reworkRate: null });
    expect([r.steps, r.byProperty, r.byPerson, r.bottleneck]).toEqual([[], [], [], null]);
  });
});

describe("how long a step took", () => {
  const at = (iso: string) => new Date(iso);
  it("adds up every round from becoming someone's turn to done", () => {
    const d = stepDurations([
      { stepId: "work", type: "step_activated", at: at("2026-11-02T17:00:00Z") },
      { stepId: "work", type: "step_completed", at: at("2026-11-04T05:00:00Z") }, // 1.5 days
      { stepId: "work", type: "step_reopened", at: at("2026-11-06T17:00:00Z") },
      { stepId: "work", type: "step_activated", at: at("2026-11-06T17:00:00Z") },
      { stepId: "work", type: "step_completed", at: at("2026-11-07T17:00:00Z") }, // 1 more day
      { stepId: "cleaning", type: "step_activated", at: at("2026-11-04T05:00:00Z") },
      { stepId: "cleaning", type: "step_skipped", at: at("2026-11-04T06:00:00Z") },
      { stepId: "photos", type: "step_completed", at: at("2026-11-05T06:00:00Z") }, // the app never saw it start
      { stepId: "leasing", type: "step_activated", at: at("2026-11-06T17:00:00Z") },
      { stepId: "leasing", type: "sent_back", at: at("2026-11-07T05:00:00Z") }, // sent the unit back: half a day there
      { stepId: "leasing", type: "step_reset", at: at("2026-11-07T05:00:00Z") },
      { stepId: "leasing", type: "step_activated", at: at("2026-11-08T17:00:00Z") },
      { stepId: "leasing", type: "step_completed", at: at("2026-11-09T17:00:00Z") },
    ]);
    expect(Object.fromEntries(d)).toEqual({ work: 2.5, leasing: 1.5 });
  });
});

describe("report periods", () => {
  it("counts back from today, including today", () => {
    expect(periodRange("30d", "2026-11-09", null)).toEqual({ from: "2026-10-11", to: "2026-11-09" });
    expect(periodRange("year", "2026-11-09", null)).toEqual({ from: "2026-01-01", to: "2026-11-09" });
    expect(periodRange("all", "2026-11-09", "2026-06-02")).toEqual({ from: "2026-06-02", to: "2026-11-09" });
    expect(earliestDate([finished("101", "2026-11-10", { moveOut: "2026-10-03" })])).toBe("2026-10-03");
  });
});
