"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isDateOnly } from "@/domain/dates";
import { WorkflowError } from "@/domain/workflow/errors";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { sendQueuedMessages } from "@/server/notifications/after-response";
import { createTurnover } from "@/server/workflow";

export interface CreateState {
  error?: string;
}

const date = z.string().refine(isDateOnly, "Pick a real date.");
const blankable = (schema: z.ZodType<string>) => z.union([z.literal(""), schema]).optional();

const single = z.object({
  propertyId: z.uuid("Pick a property."),
  unit: z.string().trim().min(1, "Enter the unit.").max(40, "That unit is too long."),
  moveOutDate: blankable(date),
  targetReadyDate: blankable(date),
  templateId: blankable(z.uuid()),
  notes: z.string().trim().max(2000).optional(),
});

function assigneesFrom(form: FormData): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || !key.startsWith("assignee:")) continue;
    const stepKey = key.slice("assignee:".length);
    result[stepKey] = z.uuid().safeParse(value).success ? value : null;
  }
  return result;
}

export async function createTurnoverAction(_previous: CreateState, form: FormData): Promise<CreateState> {
  const { actor } = await requireManager();
  const parsed = single.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  let id: string;
  try {
    const result = await createTurnover(
      await getDb(),
      {
        propertyId: v.propertyId,
        unit: v.unit,
        moveOutDate: v.moveOutDate || null,
        // Blank target: move-out + the default number of days.
        targetReadyDate: v.targetReadyDate || undefined,
        notes: v.notes || null,
        templateId: v.templateId || null,
        assignees: assigneesFrom(form),
      },
      { actor },
    );
    id = result.turnover.id;
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    throw error;
  }
  await sendQueuedMessages();
  redirect(`/turnovers/${id}`);
}

const bulkRows = z
  .array(
    z.object({
      propertyId: z.uuid(),
      unit: z.string().trim().min(1).max(40),
      moveOutDate: date.nullable(),
      targetReadyDate: date.optional(),
    }),
  )
  .min(1, "There's nothing to create.")
  .max(200, "Add at most 200 units at a time.");

export async function bulkCreateAction(_previous: CreateState, form: FormData): Promise<CreateState> {
  const { actor } = await requireManager();
  let rows: z.infer<typeof bulkRows>;
  try {
    const parsed = bulkRows.safeParse(JSON.parse(String(form.get("rows") ?? "[]")));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something in the list is wrong. Preview it again." };
    rows = parsed.data;
  } catch {
    return { error: "Something in the list is wrong. Preview it again." };
  }
  const keys = rows.map((r) => `${r.propertyId}|${r.unit.toLowerCase()}`);
  if (new Set(keys).size !== keys.length) return { error: "A unit is listed twice." };
  const templateId = z.uuid().safeParse(form.get("templateId")).data ?? null;

  const db = await getDb();
  try {
    // All or nothing: if one unit fails, none are created.
    await db.transaction(async (tx) => {
      for (const row of rows) {
        await createTurnover(tx, { ...row, templateId }, { actor });
      }
    });
  } catch (error) {
    if (error instanceof WorkflowError) return { error: `Nothing was created: ${error.message}` };
    throw error;
  }
  await sendQueuedMessages();
  redirect(`/?created=${rows.length}`);
}
