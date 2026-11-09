/**
 * Runs workflow commands against the database.
 *
 * Each command is one transaction: lock the turnover, apply the engine's
 * rules, then save the new state, the timeline events and the outgoing
 * notifications together. If any rule is broken nothing is saved.
 */
import { randomUUID } from "node:crypto";
import { and, arrayContains, asc, eq } from "drizzle-orm";
import type { DB, Executor } from "@/db/client";
import {
  processedRequests,
  people,
  properties,
  propertyStepDefaults,
  workflowTemplates,
  workflowTemplateSteps,
} from "@/db/schema";
import { getSettings } from "@/db/settings";
import { type DateOnly, dateInZone } from "@/domain/dates";
import { applyCommand, createTurnoverState } from "@/domain/workflow/engine";
import { WorkflowError } from "@/domain/workflow/errors";
import type { Actor, Command, EngineContext, EngineResult, StepTemplate } from "@/domain/workflow/types";
import { insertEvents, insertNotifications, insertTurnover, loadTurnover, saveTurnover } from "./turnover-store";

export interface RunOptions {
  actor: Actor;
  /** Defaults to the current time. Seeding and tests pass their own clock. */
  now?: Date;
  /** Sent by the browser with each tap; a repeat with the same id is ignored. */
  requestId?: string;
  /** Refuse the change if the turnover changed since the screen loaded it. */
  expectedVersion?: number;
  /** Imports and demo data don't message anyone. */
  suppressNotifications?: boolean;
}

export async function activeAdminIds(ex: Executor): Promise<string[]> {
  const rows = await ex
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.active, true), arrayContains(people.roles, ["admin"])));
  return rows.map((r) => r.id);
}

async function engineContext(ex: Executor, opts: RunOptions): Promise<EngineContext> {
  const settings = await getSettings(ex);
  const now = opts.now ?? new Date();
  return {
    actor: opts.actor,
    now,
    today: dateInZone(now, settings.timezone),
    adminIds: await activeAdminIds(ex),
    newId: randomUUID,
  };
}

export async function runCommand(
  db: DB,
  turnoverId: string,
  command: Command,
  opts: RunOptions,
): Promise<EngineResult & { duplicate: boolean }> {
  return db.transaction(async (tx) => {
    if (opts.requestId) {
      const inserted = await tx
        .insert(processedRequests)
        .values({ requestId: opts.requestId, turnoverId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) {
        const current = await loadTurnover(tx, turnoverId);
        if (!current) throw new WorkflowError("NOT_FOUND", "That turnover no longer exists.");
        return { turnover: current, events: [], notifications: [], changed: false, duplicate: true };
      }
    }

    const before = await loadTurnover(tx, turnoverId, { forUpdate: true });
    if (!before) throw new WorkflowError("NOT_FOUND", "That turnover no longer exists.");
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== before.version) {
      throw new WorkflowError("CONFLICT", "Someone else just changed this unit. Refresh to see the latest, then try again.");
    }

    const ctx = await engineContext(tx, opts);
    const result = applyCommand(before, command, ctx);
    if (result.changed) {
      await saveTurnover(tx, before, result.turnover, ctx.now);
      await insertEvents(tx, turnoverId, result.events);
      if (!opts.suppressNotifications) await insertNotifications(tx, turnoverId, result.notifications, ctx.now);
    }
    return { ...result, duplicate: false };
  });
}

export async function loadTemplate(ex: Executor, templateId?: string | null) {
  const [template] = await ex
    .select()
    .from(workflowTemplates)
    .where(templateId ? eq(workflowTemplates.id, templateId) : eq(workflowTemplates.isDefault, true));
  if (!template) throw new WorkflowError("NOT_FOUND", "That workflow template doesn't exist.");
  const rows = await ex
    .select()
    .from(workflowTemplateSteps)
    .where(eq(workflowTemplateSteps.templateId, template.id))
    .orderBy(asc(workflowTemplateSteps.position));
  const steps: StepTemplate[] = rows.map(({ id: _id, templateId: _t, ...s }) => s);
  return { template, steps };
}

export interface CreateTurnoverInput {
  propertyId: string;
  unit: string;
  moveOutDate: DateOnly | null;
  /** Leave out to default to move-out + the default target days; null for none. */
  targetReadyDate?: DateOnly | null;
  notes?: string | null;
  templateId?: string | null;
  /** Step key → person, overriding the property's defaults. */
  assignees?: Record<string, string | null>;
}

export async function createTurnover(db: Executor, input: CreateTurnoverInput, opts: RunOptions): Promise<EngineResult> {
  return db.transaction(async (tx) => {
    const [property] = await tx.select().from(properties).where(eq(properties.id, input.propertyId));
    if (!property) throw new WorkflowError("NOT_FOUND", "That property doesn't exist.");
    const { template, steps } = await loadTemplate(tx, input.templateId);
    const defaults = await tx.select().from(propertyStepDefaults).where(eq(propertyStepDefaults.propertyId, property.id));
    const assignees: Record<string, string | null> = Object.fromEntries(defaults.map((d) => [d.stepKey, d.personId]));
    Object.assign(assignees, input.assignees);

    const settings = await getSettings(tx);
    const ctx = await engineContext(tx, opts);
    const result = createTurnoverState(
      {
        id: randomUUID(),
        propertyId: property.id,
        unit: input.unit,
        moveOutDate: input.moveOutDate,
        targetReadyDate: input.targetReadyDate,
        notes: input.notes,
        steps,
        assignees,
        defaultTargetDays: settings.defaultTargetDays,
      },
      ctx,
    );
    await insertTurnover(tx, result.turnover, {
      templateId: template.id,
      templateName: template.name,
      createdById: opts.actor.personId,
      createdAt: ctx.now,
    });
    await insertEvents(tx, result.turnover.id, result.events);
    if (!opts.suppressNotifications) await insertNotifications(tx, result.turnover.id, result.notifications, ctx.now);
    return result;
  });
}
