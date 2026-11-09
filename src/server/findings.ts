/**
 * Inspection findings: what the inspector found, room by room. Only the
 * inspection's assignee (while it's their turn) or a manager can change them.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { attachments, events, inspectionFindings, turnovers } from "@/db/schema";
import { isStepActive } from "@/domain/workflow/engine";
import { WorkflowError } from "@/domain/workflow/errors";
import type { Actor, InspectionFinding } from "@/domain/workflow/types";
import { loadTurnover } from "./turnover-store";

export const ROOMS = [
  "Entry / hallway",
  "Kitchen",
  "Living / dining",
  "Bedroom 1",
  "Bedroom 2",
  "Bedroom 3",
  "Bathroom 1",
  "Bathroom 2",
  "Laundry",
  "Balcony / patio",
  "Exterior",
  "Whole unit",
] as const;

export interface Finding extends InspectionFinding {
  createdAt: Date;
}

export async function listFindings(ex: Executor, stepIds: string[]): Promise<Array<Finding & { stepId: string }>> {
  if (stepIds.length === 0) return [];
  const rows = await ex
    .select()
    .from(inspectionFindings)
    .where(inArray(inspectionFindings.stepId, stepIds))
    .orderBy(asc(inspectionFindings.createdAt));
  return rows.map((r) => ({ id: r.id, stepId: r.stepId, room: r.room, description: r.description, needsWork: r.needsWork, createdAt: r.createdAt }));
}

/** Findings for the engine when an inspection step is completed. */
export async function findingsForStep(ex: Executor, stepId: string): Promise<InspectionFinding[]> {
  return (await listFindings(ex, [stepId])).map(({ id, room, description, needsWork }) => ({ id, room, description, needsWork }));
}

/** Loads the turnover, locks it, and checks this person may change this inspection's findings. */
async function authorize(ex: Executor, actor: Actor, turnoverId: string, stepId: string) {
  const t = await loadTurnover(ex, turnoverId, { forUpdate: true });
  const index = t?.steps.findIndex((s) => s.id === stepId) ?? -1;
  if (!t || index === -1) throw new WorkflowError("NOT_FOUND", "That task no longer exists.");
  const step = t.steps[index];
  if (step.kind !== "inspection") throw new WorkflowError("INVALID_STATE", "Findings belong to the inspection step.");
  const isManager = actor.roles.includes("admin");
  if (!isManager && (step.assigneeId !== actor.personId || !isStepActive(t.steps, index))) {
    throw new WorkflowError("FORBIDDEN", "This inspection isn't yours to change right now.");
  }
  return { t, step };
}

async function touch(ex: Executor, turnoverId: string, now: Date) {
  await ex.update(turnovers).set({ updatedAt: now }).where(eq(turnovers.id, turnoverId));
}

export async function saveFinding(
  ex: Executor,
  actor: Actor,
  input: { turnoverId: string; stepId: string; findingId?: string; room: string; description: string; needsWork: boolean },
  now = new Date(),
): Promise<string> {
  const room = input.room.trim();
  const description = input.description.trim();
  if (!room || room.length > 40) throw new WorkflowError("VALIDATION", "Pick a room.");
  if (!description) throw new WorkflowError("VALIDATION", "Say what you found.");
  if (description.length > 500) throw new WorkflowError("VALIDATION", "Please keep it under 500 characters.");

  return ex.transaction(async (tx) => {
    const { step } = await authorize(tx, actor, input.turnoverId, input.stepId);
    let id = input.findingId;
    if (id) {
      const updated = await tx
        .update(inspectionFindings)
        .set({ room, description, needsWork: input.needsWork, updatedAt: now })
        .where(and(eq(inspectionFindings.id, id), eq(inspectionFindings.stepId, step.id)))
        .returning({ id: inspectionFindings.id });
      if (updated.length === 0) throw new WorkflowError("NOT_FOUND", "That finding no longer exists.");
    } else {
      [{ id }] = await tx
        .insert(inspectionFindings)
        .values({
          turnoverId: input.turnoverId,
          stepId: step.id,
          room,
          description,
          needsWork: input.needsWork,
          createdById: actor.personId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: inspectionFindings.id });
    }
    await tx.insert(events).values({
      turnoverId: input.turnoverId,
      stepId: step.id,
      actorId: actor.personId,
      type: input.findingId ? "finding_updated" : "finding_added",
      data: { findingId: id, room, description, needsWork: input.needsWork },
      at: now,
    });
    await touch(tx, input.turnoverId, now);
    return id!;
  });
}

export async function deleteFinding(
  ex: Executor,
  actor: Actor,
  input: { turnoverId: string; stepId: string; findingId: string },
  now = new Date(),
): Promise<void> {
  await ex.transaction(async (tx) => {
    const { step } = await authorize(tx, actor, input.turnoverId, input.stepId);
    const [removed] = await tx
      .delete(inspectionFindings)
      .where(and(eq(inspectionFindings.id, input.findingId), eq(inspectionFindings.stepId, step.id)))
      .returning();
    if (!removed) throw new WorkflowError("NOT_FOUND", "That finding no longer exists.");
    await tx.update(attachments).set({ deletedAt: now }).where(eq(attachments.findingId, input.findingId));
    await tx.insert(events).values({
      turnoverId: input.turnoverId,
      stepId: step.id,
      actorId: actor.personId,
      type: "finding_removed",
      data: { room: removed.room, description: removed.description },
      at: now,
    });
    await touch(tx, input.turnoverId, now);
  });
}
