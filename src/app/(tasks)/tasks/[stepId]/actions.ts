"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { WorkflowError } from "@/domain/workflow/errors";
import { requireTaskUser } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { deleteFinding, saveFinding } from "@/server/findings";
import { commandFromForm } from "@/server/forms/command-form";
import { runCommand } from "@/server/workflow";

export interface TaskState {
  ok?: boolean;
  error?: string;
  at?: number;
}

/** What someone can do on their own task. Anything else is refused before it reaches the engine. */
const ASSIGNEE_COMMANDS = new Set([
  "start",
  "schedule",
  "unschedule",
  "complete",
  "block",
  "unblock",
  "sendBack",
  "addChecklistItem",
  "setChecklistItemState",
  "addNote",
]);

function failure(error: unknown): TaskState {
  if (error instanceof WorkflowError) return { error: error.message, at: Date.now() };
  throw error;
}

export async function taskCommand(_previous: TaskState, form: FormData): Promise<TaskState> {
  const { actor } = await requireTaskUser();
  const parsed = commandFromForm(form);
  if (!parsed.ok) return { error: parsed.error, at: Date.now() };
  if (!ASSIGNEE_COMMANDS.has(parsed.command.type)) return { error: "That isn't something you can do from here.", at: Date.now() };
  if (parsed.command.type === "addNote" && !parsed.command.stepId) return { error: "Add notes to your task.", at: Date.now() };
  try {
    await runCommand(await getDb(), parsed.turnoverId, parsed.command, { actor, requestId: parsed.requestId });
  } catch (error) {
    return failure(error);
  }
  // Finishing or sending back hands the unit on, so the task leaves this person's list: show the list.
  if (parsed.command.type === "complete") redirect("/tasks?done=complete");
  if (parsed.command.type === "sendBack") redirect("/tasks?done=sentback");
  refresh();
  return { ok: true, at: Date.now() };
}

const findingForm = z.object({
  turnoverId: z.uuid(),
  stepId: z.uuid(),
  findingId: z.uuid().optional(),
  room: z.string().max(40),
  otherRoom: z.string().max(40).optional(),
  description: z.string().max(500),
  needsWork: z.enum(["yes", "no"]),
});

export async function saveFindingAction(_previous: TaskState, form: FormData): Promise<TaskState> {
  const { actor } = await requireTaskUser();
  const parsed = findingForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Pick a room and say what you found.", at: Date.now() };
  const f = parsed.data;
  try {
    await saveFinding(await getDb(), actor, {
      turnoverId: f.turnoverId,
      stepId: f.stepId,
      findingId: f.findingId,
      room: f.room === "Other" ? (f.otherRoom ?? "") : f.room,
      description: f.description,
      needsWork: f.needsWork === "yes",
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, at: Date.now() };
}

export async function deleteFindingAction(turnoverId: string, stepId: string, findingId: string): Promise<TaskState> {
  const { actor } = await requireTaskUser();
  const ids = z.tuple([z.uuid(), z.uuid(), z.uuid()]).safeParse([turnoverId, stepId, findingId]);
  if (!ids.success) return { error: "That finding no longer exists." };
  try {
    await deleteFinding(await getDb(), actor, { turnoverId, stepId, findingId });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, at: Date.now() };
}
