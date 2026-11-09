/**
 * The four calculated columns of the Master Tracker, ported formula by formula.
 *
 * Every function here is pure: it takes the row's data and "today" and returns
 * the same answer the sheet would. Nothing else in the app computes these
 * values, so the dashboard, task lists, reports and the sheet export always
 * agree with each other and with the original sheet.
 *
 * Sheet columns: C Move-out date, D Target ready date, E Current stage,
 * F Days vacant, G Days in stage, H Flag; step statuses in I, K, N, Q, S, U and
 * step dates in J, L, O, R, T, V.
 */
import { type DateOnly, daysBetween, latestDate } from "./dates";
import { isFinished, type StepStatus } from "./status";

export const COMPLETE = "Complete";

export const FLAGS = ["Complete", "Blocked", "No target date", "Overdue", "Due soon", "On track"] as const;
export type Flag = (typeof FLAGS)[number];

export interface DerivedStep {
  /** Step name, e.g. "In-house work". */
  name: string;
  /** null = blank status cell, which the sheet treats as not finished. */
  status: StepStatus | null;
}

export interface DerivedInput {
  moveOutDate: DateOnly | null;
  targetReadyDate: DateOnly | null;
  /** Steps in workflow order. */
  steps: DerivedStep[];
  /**
   * Every step date on the row (the sheet's J, L, O, R, T, V cells). In the app
   * these are the dates steps were finished, plus the date a step was reopened
   * by a send-back (something the sheet can't represent).
   */
  stepDates: Array<DateOnly | null>;
}

export interface Derived {
  /** "3. In-house work", or "Complete". */
  currentStage: string;
  /** Index into `steps` of the current stage, or null when complete. */
  currentStepIndex: number | null;
  isComplete: boolean;
  daysVacant: number | null;
  daysInStage: number | null;
  flag: Flag;
}

/** "3. In-house work": the step's number in the workflow, then its name. */
export function stageLabel(index: number, name: string): string {
  return `${index + 1}. ${name}`;
}

/**
 * Current stage (column E): the first step that isn't Done or N/A, or
 * "Complete" once every step is.
 *
 *   =IF(NOT(OR($I="Done",$I="N/A")),"1. Inspection", IF(NOT(OR($K=…)),"2. Scope of work", … ,"Complete"))
 */
export function currentStage(steps: DerivedStep[]): { label: string; index: number | null } {
  const index = steps.findIndex((s) => !isFinished(s.status));
  if (index === -1) return { label: COMPLETE, index: null };
  return { label: stageLabel(index, steps[index].name), index };
}

/**
 * Days vacant (column F): move-out to today, never negative. Once the turn is
 * complete it stops counting and uses the latest step date instead (blank if
 * there are no step dates). Blank without a move-out date.
 *
 *   =IF(OR($E="",$C=""),"", IF($E="Complete",
 *       IF(MAX(step dates)=0,"",MAX(step dates)-$C),
 *       MAX(0,TODAY()-$C)))
 */
export function daysVacant(input: DerivedInput, isComplete: boolean, today: DateOnly): number | null {
  if (!input.moveOutDate) return null;
  if (isComplete) {
    const latest = latestDate(input.stepDates);
    // The sheet does not clamp this one at zero.
    return latest === null ? null : daysBetween(latest, input.moveOutDate);
  }
  return Math.max(0, daysBetween(today, input.moveOutDate));
}

/**
 * Days in stage (column G): days since the most recent date on the row
 * (move-out, or the last step date), never negative. Blank when complete or
 * without a move-out date.
 *
 *   =IF(OR($E="",$E="Complete",$C=""),"", MAX(0,TODAY()-MAX($C, step dates)))
 */
export function daysInStage(input: DerivedInput, isComplete: boolean, today: DateOnly): number | null {
  if (isComplete || !input.moveOutDate) return null;
  const latest = latestDate([input.moveOutDate, ...input.stepDates]) as DateOnly;
  return Math.max(0, daysBetween(today, latest));
}

/**
 * Flag (column H), in this priority order: Complete, Blocked (any step marked
 * Blocked), No target date, Overdue (today is after the target date), Due soon
 * (target is within the due-soon window, including the target day itself),
 * otherwise On track.
 *
 *   =IF($E="Complete","Complete", IF(any step="Blocked","Blocked", IF($D="","No target date",
 *    IF(TODAY()>$D,"Overdue", IF($D-TODAY()<=Setup!$E$4,"Due soon","On track")))))
 */
export function flag(input: DerivedInput, isComplete: boolean, today: DateOnly, dueSoonDays: number): Flag {
  if (isComplete) return "Complete";
  if (input.steps.some((s) => s.status === "blocked")) return "Blocked";
  if (!input.targetReadyDate) return "No target date";
  if (daysBetween(today, input.targetReadyDate) > 0) return "Overdue";
  if (daysBetween(input.targetReadyDate, today) <= dueSoonDays) return "Due soon";
  return "On track";
}

/** Whether the target date has passed, regardless of what the flag shows. */
export function isPastTarget(input: DerivedInput, isComplete: boolean, today: DateOnly): boolean {
  return !isComplete && input.targetReadyDate !== null && daysBetween(today, input.targetReadyDate) > 0;
}

export function derive(input: DerivedInput, today: DateOnly, dueSoonDays: number): Derived {
  const stage = currentStage(input.steps);
  const isComplete = stage.index === null;
  return {
    currentStage: stage.label,
    currentStepIndex: stage.index,
    isComplete,
    daysVacant: daysVacant(input, isComplete, today),
    daysInStage: daysInStage(input, isComplete, today),
    flag: flag(input, isComplete, today, dueSoonDays),
  };
}
