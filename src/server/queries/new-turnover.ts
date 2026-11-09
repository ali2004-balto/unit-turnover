import { and, asc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { people, properties, propertyStepDefaults, turnovers, workflowTemplates } from "@/db/schema";
import { getSettings } from "@/db/settings";
import { dateInZone } from "@/domain/dates";
import { DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import type { Role, StepTemplate } from "@/domain/workflow/types";
import { loadTemplate } from "../workflow";

export interface NewTurnoverData {
  today: string;
  defaultTargetDays: number | null;
  properties: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string; roles: Role[] }>;
  templates: Array<{ id: string; name: string; isDefault: boolean }>;
  steps: StepTemplate[];
  /** propertyId → step key → personId */
  defaults: Record<string, Record<string, string>>;
  /** "propertyId|unit" for units with a turnover in progress. */
  activeUnits: string[];
}

export async function getNewTurnoverData(ex: Executor): Promise<NewTurnoverData> {
  const settings = await getSettings(ex);
  const [propertyRows, personRows, templateRows, defaultRows, activeRows] = await Promise.all([
    ex.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.active, true)).orderBy(asc(properties.sortOrder), asc(properties.name)),
    ex.select({ id: people.id, name: people.name, roles: people.roles }).from(people).where(eq(people.active, true)).orderBy(asc(people.name)),
    ex.select({ id: workflowTemplates.id, name: workflowTemplates.name, isDefault: workflowTemplates.isDefault }).from(workflowTemplates).where(eq(workflowTemplates.active, true)),
    ex.select().from(propertyStepDefaults),
    ex.select({ propertyId: turnovers.propertyId, unit: turnovers.unit }).from(turnovers).where(and(isNull(turnovers.completedAt), isNull(turnovers.archivedAt))),
  ]);
  const steps = await loadTemplate(ex).then(
    (t) => t.steps,
    () => DEFAULT_TEMPLATE_STEPS,
  );
  const defaults: NewTurnoverData["defaults"] = {};
  for (const d of defaultRows) (defaults[d.propertyId] ??= {})[d.stepKey] = d.personId;
  return {
    today: dateInZone(new Date(), settings.timezone),
    defaultTargetDays: settings.defaultTargetDays,
    properties: propertyRows,
    people: personRows,
    templates: templateRows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    steps,
    defaults,
    activeUnits: activeRows.map((r) => `${r.propertyId}|${r.unit.toLowerCase()}`),
  };
}
