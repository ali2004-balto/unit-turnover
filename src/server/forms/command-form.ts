/**
 * Turns a submitted form into a workflow command. Everything from the
 * browser is checked here before it reaches the engine.
 */
import { z } from "zod";
import { isDateOnly } from "@/domain/dates";
import { CHECKLIST_STATES, type Command } from "@/domain/workflow/types";

const id = z.uuid();
const date = z.string().refine(isDateOnly, "Pick a real date.");
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isDateOnly(v), "Pick a real date.");
const text = (max: number) => z.string().trim().max(max, `Please keep it under ${max} characters.`);

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), stepId: id }),
  z.object({ type: z.literal("schedule"), stepId: id, on: date, time: z.string().optional() }),
  z.object({ type: z.literal("unschedule"), stepId: id }),
  z.object({ type: z.literal("complete"), stepId: id, note: text(2000).optional() }),
  z.object({ type: z.literal("markNa"), stepId: id, reason: text(500).optional() }),
  z.object({ type: z.literal("block"), stepId: id, reason: text(500) }),
  z.object({ type: z.literal("unblock"), stepId: id, note: text(2000).optional() }),
  z.object({
    type: z.literal("sendBack"),
    fromStepId: id,
    toStepId: id,
    reason: text(500),
    reopenBetween: z.string().optional(),
  }),
  z.object({ type: z.literal("reassign"), stepId: id, assigneeId: z.string() }),
  z.object({ type: z.literal("addChecklistItem"), stepId: id, text: text(300), state: z.enum(CHECKLIST_STATES).optional() }),
  z.object({ type: z.literal("setChecklistItemState"), stepId: id, itemId: id, state: z.enum(CHECKLIST_STATES) }),
  z.object({ type: z.literal("editChecklistItem"), stepId: id, itemId: id, text: text(300) }),
  z.object({ type: z.literal("addNote"), stepId: z.string().optional(), text: text(2000) }),
  z.object({
    type: z.literal("updateTurnover"),
    moveOutDate: optionalDate,
    targetReadyDate: optionalDate,
    notes: text(2000).optional(),
  }),
]);

const envelope = z.object({
  turnoverId: id,
  /** The version the screen showed; omitted for actions that can't conflict (ticking items). */
  version: z.coerce.number().int().positive().optional(),
  requestId: z.string().min(8).max(100).optional(),
});

export type ParsedCommand =
  | { ok: true; turnoverId: string; version?: number; requestId?: string; command: Command }
  | { ok: false; error: string };

export function commandFromForm(form: FormData): ParsedCommand {
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const env = envelope.safeParse(raw);
  const body = commandSchema.safeParse(raw);
  if (!env.success || !body.success) {
    const issue = body.error?.issues[0] ?? env.error?.issues[0];
    const message = issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "Something in the form is missing. Try again.";
    return { ok: false, error: message };
  }
  const c = body.data;
  let command: Command;
  switch (c.type) {
    case "schedule":
      command = { ...c, time: c.time?.trim() || null };
      break;
    case "sendBack":
      command = { ...c, reopenBetween: c.reopenBetween === "on" };
      break;
    case "reassign":
      if (c.assigneeId !== "" && !z.uuid().safeParse(c.assigneeId).success) return { ok: false, error: "Pick someone from the list." };
      command = { type: "reassign", stepId: c.stepId, assigneeId: c.assigneeId || null };
      break;
    case "addNote":
      command = { type: "addNote", stepId: c.stepId || null, text: c.text };
      break;
    case "updateTurnover":
      command = { type: "updateTurnover", moveOutDate: c.moveOutDate, targetReadyDate: c.targetReadyDate, notes: c.notes ?? null };
      break;
    default:
      command = c;
  }
  return { ok: true, turnoverId: env.data.turnoverId, version: env.data.version, requestId: env.data.requestId, command };
}
