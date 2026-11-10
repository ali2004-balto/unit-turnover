/**
 * Loads parsed Master Tracker rows into the database, exactly as they are in
 * the sheet (statuses, dates, scope, notes). Nobody is messaged.
 */
import { randomUUID } from "node:crypto";
import { and, arrayContains, eq, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import { events, people, properties, propertyStepDefaults, turnovers } from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import type { DateOnly } from "@/domain/dates";
import { isStepReady } from "@/domain/workflow/engine";
import type { ChecklistItem, StepState, TurnoverState } from "@/domain/workflow/types";
import { isFinished } from "@/domain/status";
import { insertTurnover } from "@/server/turnover-store";
import { loadTemplate } from "@/server/workflow";
import {
  type ImportWarning,
  parseBookings,
  type ParseResult,
  type SheetRow,
  splitScope,
} from "./master-tracker";

export interface ImportOptions {
  /** Shown in each turnover's history, e.g. the CSV file name. */
  file: string;
  /** The day the sheet was exported; notes like "Sat Nov 14" are read relative to it. */
  exportedOn: DateOnly;
  /** Delete every existing turnover first. */
  replace?: boolean;
  /** Work everything out, then undo it: for a preview that's exactly what importing would do. */
  dryRun?: boolean;
  now?: Date;
}

export interface ImportReport {
  created: number;
  skipped: Array<{ rowNumber: number; reason: string }>;
  warnings: ImportWarning[];
  newProperties: string[];
  newPeople: string[];
}

const NOTE_LIMIT = 2000;

/** Carries a dry run's report out of the transaction it rolls back. */
class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super("Dry run");
  }
}

export async function importMasterTracker(db: DB, parsed: ParseResult, opts: ImportOptions): Promise<ImportReport> {
  try {
    return await importInTransaction(db, parsed, opts);
  } catch (error) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}

async function importInTransaction(db: DB, parsed: ParseResult, opts: ImportOptions): Promise<ImportReport> {
  return db.transaction(async (tx) => {
    const now = opts.now ?? new Date();
    const report: ImportReport = { created: 0, skipped: [], warnings: [...parsed.warnings], newProperties: [], newPeople: [] };
    await seedBase(tx);
    if (opts.replace) await tx.delete(turnovers);

    const { template, steps: templateSteps } = await loadTemplate(tx);
    const propertyIds = await ensureProperties(tx, parsed.rows, report);
    const crewIds = await ensureCrew(tx, parsed.rows, report);
    const defaults = await tx.select().from(propertyStepDefaults);

    const existing = await tx
      .select({ propertyId: turnovers.propertyId, unit: turnovers.unit, moveOutDate: turnovers.moveOutDate })
      .from(turnovers);
    const seen = new Set(existing.map((e) => `${e.propertyId}|${e.unit.toLowerCase()}|${e.moveOutDate ?? ""}`));

    for (const row of parsed.rows) {
      const propertyId = propertyIds.get(row.property.toLowerCase())!;
      const key = `${propertyId}|${row.unit.toLowerCase()}|${row.moveOutDate ?? ""}`;
      if (seen.has(key)) {
        report.skipped.push({ rowNumber: row.rowNumber, reason: `${row.property} ${row.unit} is already in the app` });
        continue;
      }
      seen.add(key);

      const missing = row.steps.filter((s) => !templateSteps.some((t) => t.key === s.key));
      if (missing.length > 0) {
        report.skipped.push({ rowNumber: row.rowNumber, reason: `The default template has no step for: ${missing.map((m) => m.key).join(", ")}` });
        continue;
      }

      const assignees = new Map(defaults.filter((d) => d.propertyId === propertyId).map((d) => [d.stepKey, d.personId]));
      if (row.assignedTo) assignees.set("work", crewIds.get(row.assignedTo.toLowerCase())!);

      const state = rowToState(row, propertyId, templateSteps, assignees, opts.exportedOn, now, report.warnings);
      await insertTurnover(tx, state, {
        templateId: template.id,
        templateName: template.name,
        createdById: null,
        createdAt: now,
        importSource: {
          file: opts.file,
          rowNumber: row.rowNumber,
          importedAt: now.toISOString(),
          sheetComputed: row.sheetComputed,
        },
      });
      await tx.insert(events).values({
        turnoverId: state.id,
        type: "imported",
        actorId: null,
        data: { file: opts.file, rowNumber: row.rowNumber },
        at: now,
      });
      report.created += 1;
    }
    if (opts.dryRun) throw new DryRun(report);
    return report;
  });
}

async function ensureProperties(tx: Tx, rows: SheetRow[], report: ImportReport): Promise<Map<string, string>> {
  const all = await tx.select({ id: properties.id, name: properties.name, sortOrder: properties.sortOrder }).from(properties);
  const ids = new Map(all.map((p) => [p.name.toLowerCase(), p.id]));
  let order = Math.max(0, ...all.map((p) => p.sortOrder)) + 1;
  for (const row of rows) {
    const name = row.property;
    if (ids.has(name.toLowerCase())) continue;
    const [created] = await tx.insert(properties).values({ name, sortOrder: order++ }).returning();
    ids.set(name.toLowerCase(), created.id);
    report.newProperties.push(name);
  }
  return ids;
}

/** Finds each "Assigned to" name among in-house employees, adding any that are missing. */
async function ensureCrew(tx: Tx, rows: SheetRow[], report: ImportReport): Promise<Map<string, string>> {
  const crew = await tx
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(arrayContains(people.roles, ["crew"])));
  const ids = new Map(crew.map((c) => [c.name.toLowerCase(), c.id]));
  for (const name of new Set(rows.map((r) => r.assignedTo).filter(Boolean))) {
    if (ids.has(name.toLowerCase())) continue;
    const [match] = await tx.select().from(people).where(sql`lower(${people.name}) = ${name.toLowerCase()}`);
    if (match) {
      await tx.update(people).set({ roles: [...new Set([...match.roles, "crew" as const])] }).where(eq(people.id, match.id));
      ids.set(name.toLowerCase(), match.id);
      continue;
    }
    const [created] = await tx.insert(people).values({ name, roles: ["crew"] }).returning();
    ids.set(name.toLowerCase(), created.id);
    report.newPeople.push(name);
  }
  return ids;
}

function rowToState(
  row: SheetRow,
  propertyId: string,
  templateSteps: Awaited<ReturnType<typeof loadTemplate>>["steps"],
  assignees: Map<string, string>,
  exportedOn: DateOnly,
  now: Date,
  warnings: ImportWarning[],
): TurnoverState {
  const bookings = parseBookings(row.notes, exportedOn);
  const scopeItems = splitScope(row.scopeOfWork);
  const sheetStep = (key: string) => row.steps.find((s) => s.key === key);

  const steps: StepState[] = templateSteps.map(({ checklist, ...template }) => {
    const cell = sheetStep(template.key);
    const status = cell?.status ?? "not_started";
    const finished = isFinished(status);
    let scheduledOn: DateOnly | null = null;
    let completedOn: DateOnly | null = null;
    if (cell?.date) {
      if (finished) completedOn = cell.date;
      else if (status === "scheduled") scheduledOn = cell.date;
      else warnings.push({ rowNumber: row.rowNumber, column: `${template.name} date`, message: "Date on a step that isn't Done was not imported" });
    }
    const booking = bookings[template.key as keyof typeof bookings];
    if (booking && status === "scheduled" && !scheduledOn) {
      scheduledOn = booking.on;
      if (!booking.weekdayMatches) {
        warnings.push({ rowNumber: row.rowNumber, column: "Notes / blockers", message: `The weekday in the note doesn't match ${booking.on}` });
      }
    }
    const items: ChecklistItem[] = checklist.map((text, position) => ({
      id: randomUUID(),
      text,
      state: finished ? "done" : "open",
      source: "template",
      sourceItemId: null,
      position,
      doneById: null,
      doneAt: null,
    }));
    return {
      ...template,
      id: randomUUID(),
      status,
      assigneeId: assignees.get(template.key) ?? null,
      scheduledOn,
      scheduledTime: null,
      dueOn: null,
      activatedAt: null,
      activationCount: 0,
      startedAt: null,
      completedOn,
      completedAt: null,
      reopenedOn: null,
      reopenedAt: null,
      blockedReason: status === "blocked" ? `Marked Blocked in the sheet${row.notes ? `: ${row.notes}` : ""}`.slice(0, 500) : null,
      blockedAt: status === "blocked" ? now : null,
      blockedPrevStatus: null,
      reworkCount: 0,
      checklist: items,
    };
  });

  // The sheet's "Scope of work" becomes the scope checklist, and the work step's.
  const scope = steps.find((s) => s.kind === "scope");
  const work = steps.find((s) => s.kind === "work");
  if (scope) {
    scope.checklist = scopeItems.map((item, position) => ({
      id: randomUUID(),
      text: item.text,
      state: item.toConfirm ? "to_confirm" : "open",
      source: "import",
      sourceItemId: null,
      position,
      doneById: null,
      doneAt: null,
    }));
    if (work && isFinished(scope.status)) {
      const workDone = work.status === "done";
      work.checklist = scope.checklist.map((item, position) => ({
        ...item,
        id: randomUUID(),
        state: item.state === "to_confirm" ? "to_confirm" : workDone ? "done" : "open",
        source: "scope",
        sourceItemId: item.id,
        position,
      }));
    }
  }

  // Steps that are someone's turn now count as already activated, so nobody is
  // re-notified about them; managers see them as "Needs assignee" if empty.
  steps.forEach((s, i) => {
    if (!isFinished(s.status) && isStepReady(steps, i)) {
      s.activatedAt = now;
      s.activationCount = 1;
    }
  });

  const complete = steps.every((s) => isFinished(s.status));
  return {
    id: randomUUID(),
    propertyId,
    unit: row.unit,
    moveOutDate: row.moveOutDate,
    targetReadyDate: row.targetReadyDate,
    notes: row.notes ? row.notes.slice(0, NOTE_LIMIT) : null,
    completedAt: complete ? now : null,
    version: 1,
    steps,
  };
}
