import { desc, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { events, people, properties, turnovers, turnoverSteps, type ImportSource } from "@/db/schema";
import { getSettings, type AppSettings } from "@/db/settings";
import { type DateOnly, dateInZone, daysBetween } from "@/domain/dates";
import { type Derived, derive, isPastTarget } from "@/domain/derived";
import { isFinished } from "@/domain/status";
import { describeEvents, type TimelineEntry } from "@/domain/workflow/describe";
import { isStepActive, isStepReady, isStepUpcomingBooking, turnoverDerivedInput } from "@/domain/workflow/engine";
import type { Role, StepState, TurnoverState } from "@/domain/workflow/types";
import { loadTurnover } from "../turnover-store";

export interface StepDetail {
  step: StepState;
  index: number;
  active: boolean;
  ready: boolean;
  upcomingBooking: boolean;
  /** Active and past its own due date. */
  late: boolean;
  bookingPassed: boolean;
  /** Earlier finished steps the unit could be sent back to from here. */
  sendBackTargets: Array<{ id: string; name: string }>;
  openItems: number;
}

export interface TurnoverDetail {
  turnover: TurnoverState;
  propertyName: string;
  templateName: string;
  createdAt: Date;
  createdByName: string | null;
  importSource: ImportSource | null;
  derived: Derived;
  pastTarget: boolean;
  today: DateOnly;
  settings: AppSettings;
  steps: StepDetail[];
  people: Array<{ id: string; name: string; roles: Role[]; active: boolean }>;
  timeline: TimelineEntry[];
}

export async function getTurnoverDetail(ex: Executor, id: string): Promise<TurnoverDetail | null> {
  const turnover = await loadTurnover(ex, id);
  if (!turnover) return null;
  const settings = await getSettings(ex);
  const today = dateInZone(new Date(), settings.timezone);

  const [[row], personRows, eventRows] = await Promise.all([
    ex
      .select({ turnover: turnovers, propertyName: properties.name })
      .from(turnovers)
      .innerJoin(properties, eq(properties.id, turnovers.propertyId))
      .where(eq(turnovers.id, id)),
    ex.select({ id: people.id, name: people.name, roles: people.roles, active: people.active }).from(people),
    ex
      .select({
        id: events.id,
        type: events.type,
        actorId: events.actorId,
        data: events.data,
        at: events.at,
        stepName: turnoverSteps.name,
      })
      .from(events)
      .leftJoin(turnoverSteps, eq(turnoverSteps.id, events.stepId))
      .where(eq(events.turnoverId, id))
      .orderBy(desc(events.id))
      .limit(500),
  ]);

  const names = new Map(personRows.map((p) => [p.id, p.name]));
  const input = turnoverDerivedInput(turnover);
  const derived = derive(input, today, settings.dueSoonDays);

  const steps = turnover.steps.map((step, index): StepDetail => {
    const active = isStepActive(turnover.steps, index);
    return {
      step,
      index,
      active,
      ready: isStepReady(turnover.steps, index),
      upcomingBooking: isStepUpcomingBooking(turnover.steps, index),
      late: active && step.dueOn !== null && daysBetween(today, step.dueOn) > 0,
      bookingPassed: step.status === "scheduled" && step.scheduledOn !== null && daysBetween(today, step.scheduledOn) > 0,
      sendBackTargets: turnover.steps
        .slice(0, index)
        .filter((s) => isFinished(s.status))
        .map((s) => ({ id: s.id, name: s.name })),
      openItems: step.checklist.filter((c) => c.state === "open").length,
    };
  });

  return {
    turnover,
    propertyName: row.propertyName,
    templateName: row.turnover.templateName,
    createdAt: row.turnover.createdAt,
    createdByName: row.turnover.createdById ? (names.get(row.turnover.createdById) ?? null) : null,
    importSource: row.turnover.importSource ?? null,
    derived,
    pastTarget: isPastTarget(input, derived.isComplete, today),
    today,
    settings,
    steps,
    people: personRows.sort((a, b) => a.name.localeCompare(b.name)),
    timeline: describeEvents(eventRows, (pid) => (pid ? (names.get(pid) ?? null) : null)),
  };
}
