/**
 * What every installation starts with: settings, the six-step template, and
 * the ten properties from the Setup tab. Safe to run more than once.
 */
import { eq } from "drizzle-orm";
import { DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import type { Executor } from "../client";
import { appSettings, properties, workflowTemplates, workflowTemplateSteps } from "../schema";
import { DEFAULT_SETTINGS } from "../settings";

/** The Setup tab's property list, in its order. */
export const SHEET_PROPERTIES = ["Acadian", "Arbor", "Courts", "Grandview", "Oakwood", "Parkdale", "Pioneer", "Rivergate", "WR", "Balwin"];

export async function seedBase(ex: Executor): Promise<{ templateId: string; propertyIds: Map<string, string> }> {
  await ex.insert(appSettings).values(DEFAULT_SETTINGS).onConflictDoNothing();

  let [template] = await ex.select().from(workflowTemplates).where(eq(workflowTemplates.isDefault, true));
  if (!template) {
    [template] = await ex
      .insert(workflowTemplates)
      .values({
        name: DEFAULT_TEMPLATE_NAME,
        description: "The six steps from the Master Tracker sheet.",
        isDefault: true,
      })
      .returning();
    await ex.insert(workflowTemplateSteps).values(DEFAULT_TEMPLATE_STEPS.map((s) => ({ ...s, templateId: template.id })));
  }

  await ex
    .insert(properties)
    .values(SHEET_PROPERTIES.map((name, i) => ({ name, sortOrder: i })))
    .onConflictDoNothing();
  const rows = await ex.select({ id: properties.id, name: properties.name }).from(properties);
  return { templateId: template.id, propertyIds: new Map(rows.map((r) => [r.name, r.id])) };
}
