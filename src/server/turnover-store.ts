/**
 * Loading and saving a turnover's full state (the turnover, its steps and
 * their checklists) for the workflow engine.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { checklistItems, events, notifications, turnovers, turnoverSteps } from "@/db/schema";
import type {
  ChecklistItem,
  EventDraft,
  NotificationDraft,
  StepState,
  TurnoverState,
} from "@/domain/workflow/types";

type StepRow = typeof turnoverSteps.$inferSelect;
type ItemRow = typeof checklistItems.$inferSelect;
type TurnoverRow = typeof turnovers.$inferSelect;

function toItem(r: ItemRow): ChecklistItem {
  return {
    id: r.id,
    text: r.text,
    state: r.state,
    source: r.source,
    sourceItemId: r.sourceItemId,
    position: r.position,
    doneById: r.doneById,
    doneAt: r.doneAt,
  };
}

function toStep(r: StepRow, items: ItemRow[]): StepState {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    position: r.position,
    parallelWithPrevious: r.parallelWithPrevious,
    role: r.role,
    kind: r.kind,
    allowNa: r.allowNa,
    requireChecklist: r.requireChecklist,
    dueDays: r.dueDays,
    escalateAfterDays: r.escalateAfterDays,
    status: r.status,
    assigneeId: r.assigneeId,
    scheduledOn: r.scheduledOn,
    scheduledTime: r.scheduledTime,
    dueOn: r.dueOn,
    activatedAt: r.activatedAt,
    activationCount: r.activationCount,
    startedAt: r.startedAt,
    completedOn: r.completedOn,
    completedAt: r.completedAt,
    reopenedOn: r.reopenedOn,
    reopenedAt: r.reopenedAt,
    blockedReason: r.blockedReason,
    blockedAt: r.blockedAt,
    blockedPrevStatus: r.blockedPrevStatus,
    reworkCount: r.reworkCount,
    checklist: items.filter((i) => i.stepId === r.id).map(toItem),
  };
}

export function toTurnoverState(row: TurnoverRow, steps: StepRow[], items: ItemRow[]): TurnoverState {
  return {
    id: row.id,
    propertyId: row.propertyId,
    unit: row.unit,
    moveOutDate: row.moveOutDate,
    targetReadyDate: row.targetReadyDate,
    notes: row.notes,
    completedAt: row.completedAt,
    version: row.version,
    steps: [...steps].sort((a, b) => a.position - b.position).map((s) => toStep(s, items)),
  };
}

/** Loads one turnover. With forUpdate, locks it until the transaction ends so changes can't cross. */
export async function loadTurnover(ex: Executor, id: string, opts: { forUpdate?: boolean } = {}): Promise<TurnoverState | null> {
  const query = ex.select().from(turnovers).where(eq(turnovers.id, id));
  const [row] = opts.forUpdate ? await query.for("update") : await query;
  if (!row) return null;
  const steps = await ex.select().from(turnoverSteps).where(eq(turnoverSteps.turnoverId, id)).orderBy(asc(turnoverSteps.position));
  const items =
    steps.length === 0
      ? []
      : await ex
          .select()
          .from(checklistItems)
          .where(inArray(checklistItems.stepId, steps.map((s) => s.id)))
          .orderBy(asc(checklistItems.position));
  return toTurnoverState(row, steps, items);
}

function stepColumns(s: StepState) {
  const { checklist: _checklist, id: _id, ...columns } = s;
  return columns;
}

function itemColumns(i: ChecklistItem) {
  const { id: _id, ...columns } = i;
  return columns;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface NewTurnoverMeta {
  templateId: string | null;
  templateName: string;
  createdById: string | null;
  importSource?: TurnoverRow["importSource"];
  createdAt?: Date;
}

export async function insertTurnover(ex: Executor, t: TurnoverState, meta: NewTurnoverMeta): Promise<void> {
  const at = meta.createdAt ?? new Date();
  await ex.insert(turnovers).values({
    id: t.id,
    propertyId: t.propertyId,
    unit: t.unit,
    moveOutDate: t.moveOutDate,
    targetReadyDate: t.targetReadyDate,
    notes: t.notes,
    completedAt: t.completedAt,
    version: t.version,
    templateId: meta.templateId,
    templateName: meta.templateName,
    createdById: meta.createdById,
    importSource: meta.importSource ?? null,
    createdAt: at,
    updatedAt: at,
  });
  await ex.insert(turnoverSteps).values(t.steps.map((s) => ({ id: s.id, turnoverId: t.id, ...stepColumns(s), updatedAt: at })));
  const items = t.steps.flatMap((s) => s.checklist.map((i) => ({ id: i.id, stepId: s.id, ...itemColumns(i), createdAt: at })));
  if (items.length > 0) await ex.insert(checklistItems).values(items);
}

/** Writes only what changed between `before` and `after`. */
export async function saveTurnover(ex: Executor, before: TurnoverState, after: TurnoverState, now: Date): Promise<void> {
  await ex
    .update(turnovers)
    .set({
      moveOutDate: after.moveOutDate,
      targetReadyDate: after.targetReadyDate,
      notes: after.notes,
      completedAt: after.completedAt,
      version: after.version,
      updatedAt: now,
    })
    .where(eq(turnovers.id, after.id));

  const previousSteps = new Map(before.steps.map((s) => [s.id, s]));
  for (const step of after.steps) {
    const previous = previousSteps.get(step.id);
    if (!previous || !same(stepColumns(previous), stepColumns(step))) {
      await ex.update(turnoverSteps).set({ ...stepColumns(step), updatedAt: now }).where(eq(turnoverSteps.id, step.id));
    }
    const previousItems = new Map((previous?.checklist ?? []).map((i) => [i.id, i]));
    const added = step.checklist.filter((i) => !previousItems.has(i.id));
    if (added.length > 0) {
      await ex.insert(checklistItems).values(added.map((i) => ({ id: i.id, stepId: step.id, ...itemColumns(i), createdAt: now })));
    }
    for (const item of step.checklist) {
      const old = previousItems.get(item.id);
      if (old && !same(old, item)) await ex.update(checklistItems).set(itemColumns(item)).where(eq(checklistItems.id, item.id));
    }
  }
}

export async function insertEvents(ex: Executor, turnoverId: string, drafts: EventDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  await ex.insert(events).values(drafts.map((e) => ({ turnoverId, ...e })));
}

export async function insertNotifications(ex: Executor, turnoverId: string, drafts: NotificationDraft[], sendAfter: Date): Promise<void> {
  if (drafts.length === 0) return;
  await ex
    .insert(notifications)
    .values(drafts.map((n) => ({ turnoverId, sendAfter, ...n })))
    .onConflictDoNothing({ target: notifications.dedupeKey });
}
