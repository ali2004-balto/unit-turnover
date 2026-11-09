/**
 * Read models for screens: every turnover with its steps, people's names and
 * the sheet's calculated values.
 */
import { asc, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { checklistItems, people, properties, turnovers, turnoverSteps, type ImportSource } from "@/db/schema";
import { getSettings, type AppSettings } from "@/db/settings";
import { type DateOnly, dateInZone } from "@/domain/dates";
import { type Derived, derive, isPastTarget } from "@/domain/derived";
import { turnoverDerivedInput } from "@/domain/workflow/engine";
import type { Role, TurnoverState } from "@/domain/workflow/types";
import { toTurnoverState } from "../turnover-store";

export interface PersonSummary {
  id: string;
  name: string;
  roles: Role[];
  isPlaceholder: boolean;
}

export interface TurnoverView {
  turnover: TurnoverState;
  propertyName: string;
  propertySortOrder: number;
  templateName: string;
  importSource: ImportSource | null;
  derived: Derived;
  /** Past the target date even when the flag shows something else (e.g. Blocked). */
  pastTarget: boolean;
}

export interface TurnoverList {
  today: DateOnly;
  settings: AppSettings;
  rows: TurnoverView[];
  people: Map<string, PersonSummary>;
}

export async function listTurnovers(ex: Executor, opts: { today?: DateOnly } = {}): Promise<TurnoverList> {
  const settings = await getSettings(ex);
  const today = opts.today ?? dateInZone(new Date(), settings.timezone);

  const [turnoverRows, propertyRows, stepRows, itemRows, personRows] = await Promise.all([
    ex.select().from(turnovers).where(isNull(turnovers.archivedAt)),
    ex.select().from(properties),
    ex.select().from(turnoverSteps).orderBy(asc(turnoverSteps.position)),
    ex.select().from(checklistItems).orderBy(asc(checklistItems.position)),
    ex.select().from(people),
  ]);

  const propertyById = new Map(propertyRows.map((p) => [p.id, p]));
  const stepsByTurnover = Map.groupBy(stepRows, (s) => s.turnoverId);
  const itemsByStep = Map.groupBy(itemRows, (i) => i.stepId);

  const rows = turnoverRows.map((row): TurnoverView => {
    const steps = stepsByTurnover.get(row.id) ?? [];
    const items = steps.flatMap((s) => itemsByStep.get(s.id) ?? []);
    const turnover = toTurnoverState(row, steps, items);
    const input = turnoverDerivedInput(turnover);
    const derived = derive(input, today, settings.dueSoonDays);
    const property = propertyById.get(row.propertyId);
    return {
      turnover,
      propertyName: property?.name ?? "?",
      propertySortOrder: property?.sortOrder ?? 0,
      templateName: row.templateName,
      importSource: row.importSource ?? null,
      derived,
      pastTarget: isPastTarget(input, derived.isComplete, today),
    };
  });

  rows.sort(
    (a, b) =>
      a.propertySortOrder - b.propertySortOrder ||
      a.turnover.unit.localeCompare(b.turnover.unit, undefined, { numeric: true }),
  );

  return {
    today,
    settings,
    rows,
    people: new Map(
      personRows.map((p) => [p.id, { id: p.id, name: p.name, roles: p.roles, isPlaceholder: p.isPlaceholder }]),
    ),
  };
}
