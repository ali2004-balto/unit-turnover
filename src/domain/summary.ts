/**
 * The Summary tab, ported formula by formula: headline numbers, the pipeline
 * by stage, and the in-house crew workload.
 */
import type { Derived } from "./derived";
import { COMPLETE } from "./derived";
import type { DateOnly } from "./dates";
import type { StepStatus } from "./status";

export interface SummaryRowInput {
  derived: Derived;
  moveOutDate: DateOnly | null;
  /** The in-house work step(s): who is assigned and their status. */
  work: Array<{ assigneeName: string | null; status: StepStatus | null }>;
}

export interface PipelineRow {
  stage: string;
  unitsNow: number;
  /** null shows as "-" like the sheet. */
  avgDaysInStage: number | null;
  longestInStage: number | null;
}

export interface CrewRow {
  name: string;
  openJobs: number;
  inProgress: number;
  completedAllTime: number;
}

export interface Summary {
  activeTurns: number;
  overdue: number;
  dueSoon: number;
  blocked: number;
  completedAllTime: number;
  avgDaysVacantActive: number | null;
  avgDaysToComplete: number | null;
  missingMoveOut: number;
  pipeline: PipelineRow[];
  totalActive: number;
  crew: CrewRow[];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function isNumber(v: number | null): v is number {
  return v !== null;
}

/**
 * @param stageLabels the pipeline rows, in order ("1. Inspection" … "6. Leasing upload")
 * @param crewNames   the in-house employee list (the Setup tab's column B)
 */
export function summarize(rows: SummaryRowInput[], stageLabels: string[], crewNames: string[]): Summary {
  const notComplete = rows.filter((r) => r.derived.currentStage !== COMPLETE);
  const complete = rows.filter((r) => r.derived.currentStage === COMPLETE);
  const countFlag = (f: string) => rows.filter((r) => r.derived.flag === f).length;

  const pipeline = stageLabels.map((stage): PipelineRow => {
    const inStage = rows.filter((r) => r.derived.currentStage === stage);
    const days = inStage.map((r) => r.derived.daysInStage).filter(isNumber);
    return {
      stage,
      // =COUNTIF(E, stage)
      unitsNow: inStage.length,
      // =IFERROR(AVERAGEIF(E, stage, G), "-")
      avgDaysInStage: average(days),
      // =IF(COUNTIFS(E, stage, G, ">=0")=0, "-", MAXIFS(G, E, stage))
      longestInStage: days.length === 0 ? null : Math.max(...days),
    };
  });

  const crew = crewNames.map((name): CrewRow => {
    const jobs = rows.flatMap((r) => r.work).filter((w) => w.assigneeName === name);
    return {
      name,
      // =COUNTIFS(P, name, N, "<>Done", N, "<>N/A")
      openJobs: jobs.filter((w) => w.status !== "done" && w.status !== "na").length,
      // =COUNTIFS(P, name, N, "In progress")
      inProgress: jobs.filter((w) => w.status === "in_progress").length,
      // =COUNTIFS(P, name, N, "Done")
      completedAllTime: jobs.filter((w) => w.status === "done").length,
    };
  });

  return {
    // =SUMPRODUCT((E<>"")*(E<>"Complete"))
    activeTurns: notComplete.length,
    overdue: countFlag("Overdue"),
    dueSoon: countFlag("Due soon"),
    blocked: countFlag("Blocked"),
    // =COUNTIF(E, "Complete")
    completedAllTime: complete.length,
    // =IFERROR(AVERAGEIF(E, "<>Complete", F), "-")
    avgDaysVacantActive: average(notComplete.map((r) => r.derived.daysVacant).filter(isNumber)),
    // =IFERROR(AVERAGEIF(E, "Complete", F), "-")
    avgDaysToComplete: average(complete.map((r) => r.derived.daysVacant).filter(isNumber)),
    // =SUMPRODUCT((E<>"")*(C=""))
    missingMoveOut: rows.filter((r) => r.moveOutDate === null).length,
    pipeline,
    // =SUM(units now)
    totalActive: pipeline.reduce((a, p) => a + p.unitsNow, 0),
    crew,
  };
}
