/**
 * Loads everything the reports need: every turnover (finished and archived
 * ones too), each step's time from the timeline, and the send-backs.
 */
import { asc, inArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { events, people, properties, turnovers, turnoverSteps } from "@/db/schema";
import { getSettings } from "@/db/settings";
import { type DateOnly, dateInZone } from "@/domain/dates";
import {
  buildReport,
  earliestDate,
  periodRange,
  type Report,
  type ReportPeriod,
  type ReportSendBack,
  type ReportTurnover,
  stepDurations,
} from "@/domain/reports";

export interface ReportPage {
  report: Report;
  today: DateOnly;
  properties: Array<{ id: string; name: string }>;
}

export async function loadReport(ex: Executor, opts: { period: ReportPeriod; propertyId?: string | null; today?: DateOnly }): Promise<ReportPage> {
  const settings = await getSettings(ex);
  const today = opts.today ?? dateInZone(new Date(), settings.timezone);
  const [turnoverRows, propertyRows, stepRows, personRows, timeline] = await Promise.all([
    ex.select().from(turnovers),
    ex.select({ id: properties.id, name: properties.name, sortOrder: properties.sortOrder }).from(properties).orderBy(asc(properties.sortOrder)),
    ex.select().from(turnoverSteps).orderBy(asc(turnoverSteps.position)),
    ex.select({ id: people.id, name: people.name }).from(people),
    ex
      .select({ turnoverId: events.turnoverId, stepId: events.stepId, type: events.type, at: events.at, data: events.data })
      .from(events)
      .where(inArray(events.type, ["step_activated", "step_completed", "step_skipped", "step_reopened", "sent_back"])),
  ]);

  const durations = stepDurations(timeline);
  const propertyName = new Map(propertyRows.map((p) => [p.id, p.name]));
  const stepsByTurnover = Map.groupBy(stepRows, (s) => s.turnoverId);
  const stepById = new Map(stepRows.map((s) => [s.id, s]));

  const all: ReportTurnover[] = turnoverRows.map((t) => ({
    id: t.id,
    propertyId: t.propertyId,
    property: propertyName.get(t.propertyId) ?? "?",
    unit: t.unit,
    moveOutDate: t.moveOutDate,
    targetReadyDate: t.targetReadyDate,
    steps: (stepsByTurnover.get(t.id) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      assigneeId: s.assigneeId,
      completedOn: s.completedOn,
      reopenedOn: s.reopenedOn,
      dueOn: s.dueOn,
      daysAtStep: s.status === "done" ? (durations.get(s.id) ?? null) : null,
    })),
  }));

  const allSendBacks: ReportSendBack[] = timeline
    .filter((e) => e.type === "sent_back")
    .map((e) => {
      const to = typeof e.data.toStepId === "string" ? stepById.get(e.data.toStepId) : undefined;
      return {
        turnoverId: e.turnoverId,
        on: dateInZone(e.at, settings.timezone),
        fromStep: (e.stepId && stepById.get(e.stepId)?.name) || "A later step",
        toStep: to?.name ?? (typeof e.data.toStepName === "string" ? e.data.toStepName : "An earlier step"),
        toAssigneeId: to?.assigneeId ?? null,
      };
    });

  const propertyId = opts.propertyId && propertyName.has(opts.propertyId) ? opts.propertyId : null;
  const chosen = propertyId ? all.filter((t) => t.propertyId === propertyId) : all;
  const chosenIds = new Set(chosen.map((t) => t.id));
  const { from, to } = periodRange(opts.period, today, earliestDate(chosen));
  const report = buildReport({
    from,
    to,
    turnovers: chosen,
    sendBacks: allSendBacks.filter((sb) => chosenIds.has(sb.turnoverId)),
    people: new Map(personRows.map((p) => [p.id, p.name])),
  });
  return { report, today, properties: propertyRows.map(({ id, name }) => ({ id, name })) };
}
