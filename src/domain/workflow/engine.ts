/**
 * The workflow engine: every change to a turnover goes through here.
 *
 * It is pure. Given a turnover's current state, a command and who is asking,
 * it checks the rules and returns the new state plus the timeline events and
 * notifications the change causes. The server saves all three in one database
 * transaction (src/server/workflow.ts), so a handoff can never happen without
 * its notification, or the other way round.
 *
 * Handoff rule: a step becomes active when every step before it is Done or
 * N/A. Steps marked "parallel with previous" form a group that starts
 * together, and the step after the group waits for all of them (the join).
 */
import { addDays, type DateOnly, isDateOnly } from "../dates";
import type { DerivedInput } from "../derived";
import { isFinished, STATUS_LABELS, type StepStatus } from "../status";
import { WorkflowError } from "./errors";
import type {
  Actor,
  ChecklistItem,
  ChecklistState,
  Command,
  EngineContext,
  EngineResult,
  EventDraft,
  InspectionFinding,
  NotificationDraft,
  NotificationKind,
  StepState,
  StepTemplate,
  TurnoverState,
} from "./types";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_REASON = 500;
const MAX_ITEM = 300;
const MAX_NOTE = 2000;

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** Group number of each step: consecutive "parallel with previous" steps share one. */
export function stepGroups(steps: readonly Pick<StepState, "parallelWithPrevious">[]): number[] {
  let group = -1;
  return steps.map((s, i) => {
    if (i === 0 || !s.parallelWithPrevious) group += 1;
    return group;
  });
}

/** Every step in an earlier group is Done or N/A. */
export function isStepReady(steps: readonly StepState[], index: number): boolean {
  const groups = stepGroups(steps);
  return steps.every((s, i) => groups[i] >= groups[index] || isFinished(s.status));
}

/** It is this step's turn: ready, and not yet finished. */
export function isStepActive(steps: readonly StepState[], index: number): boolean {
  return !isFinished(steps[index].status) && isStepReady(steps, index);
}

export function activeSteps(t: TurnoverState): StepState[] {
  return t.steps.filter((_, i) => isStepActive(t.steps, i));
}

/** A future step that has been booked ahead (shown to its assignee as "Upcoming"). */
export function isStepUpcomingBooking(steps: readonly StepState[], index: number): boolean {
  return steps[index].status === "scheduled" && !isStepReady(steps, index);
}

/** The turnover's data as the sheet's formulas see it. */
export function turnoverDerivedInput(t: Pick<TurnoverState, "moveOutDate" | "targetReadyDate" | "steps">): DerivedInput {
  return {
    moveOutDate: t.moveOutDate,
    targetReadyDate: t.targetReadyDate,
    steps: t.steps.map((s) => ({ name: s.name, status: s.status })),
    // The sheet's step dates are the dates steps were finished. A send-back
    // reopening a step also counts as a date on the row, so "days in stage"
    // restarts from it.
    stepDates: t.steps.flatMap((s) => [s.completedOn, s.reopenedOn]),
  };
}

// ---------------------------------------------------------------------------
// Running a command
// ---------------------------------------------------------------------------

type ActivationHint = { reason: "sent_back"; data: Record<string, unknown> };

class Run {
  readonly events: EventDraft[] = [];
  readonly notifications: NotificationDraft[] = [];
  readonly hints = new Map<string, ActivationHint>();
  changed = false;

  constructor(
    readonly t: TurnoverState,
    readonly ctx: EngineContext,
  ) {}

  get actor(): Actor {
    return this.ctx.actor;
  }

  get isAdmin(): boolean {
    return this.actor.roles.includes("admin");
  }

  step(stepId: string): [StepState, number] {
    const index = this.t.steps.findIndex((s) => s.id === stepId);
    if (index === -1) throw new WorkflowError("NOT_FOUND", "That step isn't part of this turnover.");
    return [this.t.steps[index], index];
  }

  /** Managers can act on any step; everyone else only on their own step, and only when it's its turn. */
  requireCanAct(step: StepState, index: number): void {
    if (this.isAdmin) return;
    if (!this.actor.personId || step.assigneeId !== this.actor.personId) {
      throw new WorkflowError("FORBIDDEN", "This task isn't assigned to you.");
    }
    if (!isStepActive(this.t.steps, index)) {
      throw new WorkflowError("FORBIDDEN", "It isn't this step's turn yet.");
    }
  }

  requireAdmin(what: string): void {
    if (!this.isAdmin) throw new WorkflowError("FORBIDDEN", `Only a manager can ${what}.`);
  }

  event(
    type: string,
    step: StepState | null,
    data: Record<string, unknown> = {},
    fromStatus: StepStatus | null = null,
    toStatus: StepStatus | null = null,
  ): void {
    this.changed = true;
    this.events.push({
      type,
      stepId: step?.id ?? null,
      actorId: this.actor.personId,
      fromStatus,
      toStatus,
      data,
      at: this.ctx.now,
    });
  }

  /** Queue a message. Nobody is told about something they just did themselves. */
  notify(
    recipientId: string | null,
    kind: NotificationKind,
    step: StepState | null,
    data: Record<string, unknown> = {},
    dedupe?: string,
  ): void {
    if (!recipientId || recipientId === this.actor.personId) return;
    this.notifications.push({
      recipientId,
      kind,
      stepId: step?.id ?? null,
      data: { unit: this.t.unit, stepName: step?.name ?? null, ...data },
      dedupeKey: dedupe ? `${kind}:${dedupe}:${recipientId}` : null,
    });
  }

  notifyAdmins(kind: NotificationKind, step: StepState | null, data: Record<string, unknown> = {}, dedupe?: string): void {
    for (const adminId of this.ctx.adminIds) this.notify(adminId, kind, step, data, dedupe);
  }

  /** Activate steps that just became ready; put steps that are no longer ready back to waiting. */
  syncActivation(): void {
    const { steps } = this.t;
    steps.forEach((s, i) => {
      const active = isStepActive(steps, i);
      if (active && s.activatedAt === null) {
        s.activatedAt = this.ctx.now;
        s.activationCount += 1;
        if (s.dueOn === null && s.dueDays !== null) s.dueOn = addDays(this.ctx.today, s.dueDays);
        const hint = this.hints.get(s.id);
        this.event("step_activated", s, { reason: hint?.reason ?? "ready" });
        const dedupe = `${s.id}:${s.activationCount}`;
        if (s.assigneeId) {
          const kind: NotificationKind = hint
            ? "step_sent_back"
            : s.status === "scheduled"
              ? "step_ready_booked"
              : "step_assigned";
          this.notify(s.assigneeId, kind, s, { ...hint?.data, scheduledOn: s.scheduledOn, scheduledTime: s.scheduledTime, dueOn: s.dueOn }, dedupe);
        } else {
          this.notifyAdmins("needs_assignee", s, {}, dedupe);
        }
      } else if (!active && s.activatedAt !== null && !isFinished(s.status)) {
        s.activatedAt = null;
      }
    });
  }

  syncCompletion(): void {
    const complete = this.t.steps.every((s) => isFinished(s.status));
    if (complete && this.t.completedAt === null) {
      this.t.completedAt = this.ctx.now;
      this.event("turnover_completed", null);
      this.notifyAdmins("turnover_completed", null, {}, `${this.t.id}:${this.ctx.now.toISOString()}`);
    } else if (!complete && this.t.completedAt !== null) {
      this.t.completedAt = null;
      this.event("turnover_reopened", null);
    }
  }

  finishStep(s: StepState, status: "done" | "na"): void {
    s.status = status;
    s.completedOn = this.ctx.today;
    s.completedAt = this.ctx.now;
    s.blockedReason = null;
    s.blockedAt = null;
    s.blockedPrevStatus = null;
  }

  newChecklistItem(step: StepState, text: string, fields: Partial<ChecklistItem> = {}): ChecklistItem {
    const position = step.checklist.reduce((max, c) => Math.max(max, c.position), -1) + 1;
    const item: ChecklistItem = {
      id: this.ctx.newId(),
      text,
      state: "open",
      source: "manual",
      sourceItemId: null,
      position,
      doneById: null,
      doneAt: null,
      ...fields,
    };
    step.checklist.push(item);
    return item;
  }
}

function requireText(value: string | undefined, max: number, emptyMessage: string): string {
  const text = (value ?? "").trim();
  if (text === "") throw new WorkflowError("VALIDATION", emptyMessage);
  if (text.length > max) throw new WorkflowError("VALIDATION", `Please keep it under ${max} characters.`);
  return text;
}

function optionalText(value: string | undefined, max: number): string | undefined {
  const text = (value ?? "").trim();
  if (text.length > max) throw new WorkflowError("VALIDATION", `Please keep it under ${max} characters.`);
  return text === "" ? undefined : text;
}

function clearBooking(s: StepState): void {
  s.scheduledOn = null;
  s.scheduledTime = null;
}

function reopenStep(run: Run, s: StepState): StepStatus {
  const previous = s.status;
  s.status = "not_started";
  s.completedOn = null;
  s.completedAt = null;
  s.startedAt = null;
  s.activatedAt = null;
  s.dueOn = null;
  s.reopenedOn = run.ctx.today;
  s.reopenedAt = run.ctx.now;
  s.blockedReason = null;
  s.blockedAt = null;
  s.blockedPrevStatus = null;
  clearBooking(s);
  return previous;
}

/** Finishing the inspection drafts the scope: each finding that needs work becomes a scope item. */
function applyFindings(run: Run, inspectionIndex: number, findings: InspectionFinding[]): void {
  const scopeIndex = run.t.steps.findIndex((s, i) => i > inspectionIndex && s.kind === "scope");
  if (scopeIndex === -1) return;
  const scope = run.t.steps[scopeIndex];
  const already = new Set(scope.checklist.map((c) => c.sourceItemId).filter(Boolean));
  let added = 0;
  for (const f of findings) {
    if (!f.needsWork || already.has(f.id)) continue;
    const text = f.room && f.room !== "Whole unit" ? `${f.room}: ${f.description}` : f.description;
    run.newChecklistItem(scope, text.slice(0, 300), { source: "inspection", sourceItemId: f.id });
    added += 1;
  }
  if (added > 0) run.event("findings_applied", scope, { items: added });
}

/** Approving the scope gives the work step its checklist, or skips it when there is nothing to do. */
function applyScope(run: Run, scope: StepState, scopeIndex: number): void {
  const workIndex = run.t.steps.findIndex((s, i) => i > scopeIndex && s.kind === "work");
  if (workIndex === -1) return;
  const work = run.t.steps[workIndex];
  const items = scope.checklist.filter((c) => c.state !== "dropped");

  if (items.length === 0) {
    if (work.allowNa && !isFinished(work.status)) {
      const from = work.status;
      const wasBooked = work.scheduledOn !== null;
      clearBooking(work);
      run.finishStep(work, "na");
      run.event("step_skipped", work, { reason: "No work needed: the approved scope is empty", automatic: true }, from, "na");
      if (wasBooked) run.notify(work.assigneeId, "booking_cancelled", work, { reason: "No work needed" });
    }
    return;
  }

  const alreadyCopied = new Set(work.checklist.map((c) => c.sourceItemId).filter(Boolean));
  let added = 0;
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    if (alreadyCopied.has(item.id)) continue;
    run.newChecklistItem(work, item.text, {
      state: item.state === "to_confirm" ? "to_confirm" : "open",
      source: "scope",
      sourceItemId: item.id,
    });
    added += 1;
  }
  if (added > 0) run.event("scope_applied", work, { items: added });
}

function handle(run: Run, command: Command): void {
  const { ctx, t } = run;

  switch (command.type) {
    case "start": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      if (s.status === "in_progress") return;
      if (s.status === "blocked") throw new WorkflowError("INVALID_STATE", "This step is blocked. Unblock it first.");
      if (isFinished(s.status)) throw new WorkflowError("INVALID_STATE", "This step is already finished.");
      const from = s.status;
      s.status = "in_progress";
      s.startedAt ??= ctx.now;
      run.event("step_started", s, {}, from, "in_progress");
      return;
    }

    case "schedule": {
      const [s, i] = run.step(command.stepId);
      // Managers can book any step ahead of time; assignees can book their own active step.
      run.requireCanAct(s, i);
      if (!isDateOnly(command.on)) throw new WorkflowError("VALIDATION", "Pick a booking date.");
      const time = command.time?.trim() || null;
      if (time !== null && !TIME.test(time)) throw new WorkflowError("VALIDATION", "Use a time like 09:30.");
      if (s.status === "blocked") throw new WorkflowError("INVALID_STATE", "This step is blocked. Unblock it first.");
      if (isFinished(s.status)) throw new WorkflowError("INVALID_STATE", "This step is already finished.");
      if (s.status === "in_progress") throw new WorkflowError("INVALID_STATE", "This step has already started.");
      if (s.status === "scheduled" && s.scheduledOn === command.on && s.scheduledTime === time) return;
      const from = s.status;
      const previousOn = s.scheduledOn;
      s.status = "scheduled";
      s.scheduledOn = command.on;
      s.scheduledTime = time;
      const active = isStepActive(t.steps, i);
      run.event("step_scheduled", s, { on: command.on, time, previousOn, ahead: !active }, from, "scheduled");
      run.notify(s.assigneeId, active ? "step_scheduled" : "booking_created", s, { on: command.on, time });
      return;
    }

    case "unschedule": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      if (s.status !== "scheduled") return;
      const previousOn = s.scheduledOn;
      s.status = "not_started";
      clearBooking(s);
      run.event("step_unscheduled", s, { previousOn }, "scheduled", "not_started");
      run.notify(s.assigneeId, "booking_cancelled", s, { on: previousOn });
      return;
    }

    case "complete": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      if (isFinished(s.status)) throw new WorkflowError("INVALID_STATE", "This step is already finished.");
      if (s.requireChecklist && !run.isAdmin) {
        const open = s.checklist.filter((c) => c.state === "open").length;
        if (open > 0) {
          throw new WorkflowError(
            "CHECKLIST_INCOMPLETE",
            `${open} checklist item${open === 1 ? " is" : "s are"} still open. Tick ${open === 1 ? "it" : "them"} off first.`,
          );
        }
      }
      const note = optionalText(command.note, MAX_NOTE);
      const from = s.status;
      s.startedAt ??= ctx.now;
      run.finishStep(s, "done");
      run.event("step_completed", s, note ? { note } : {}, from, "done");
      if (s.kind === "inspection") applyFindings(run, i, command.findings ?? []);
      if (s.kind === "scope") applyScope(run, s, i);
      return;
    }

    case "markNa": {
      run.requireAdmin("mark a step N/A");
      const [s, i] = run.step(command.stepId);
      if (!s.allowNa) throw new WorkflowError("INVALID_STATE", `${s.name} can't be marked N/A.`);
      if (s.status === "na") return;
      if (s.status === "done") throw new WorkflowError("INVALID_STATE", "This step is already done.");
      const reason = optionalText(command.reason, MAX_REASON);
      const wasActive = isStepActive(t.steps, i);
      const wasBooked = s.scheduledOn !== null;
      const from = s.status;
      clearBooking(s);
      run.finishStep(s, "na");
      run.event("step_skipped", s, reason ? { reason } : {}, from, "na");
      if (wasActive) run.notify(s.assigneeId, "step_cancelled", s, { reason });
      else if (wasBooked) run.notify(s.assigneeId, "booking_cancelled", s, { reason });
      return;
    }

    case "block": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      const reason = requireText(command.reason, MAX_REASON, "Say what it's waiting on (parts, access or a decision).");
      if (isFinished(s.status)) throw new WorkflowError("INVALID_STATE", "This step is already finished.");
      if (s.status === "blocked") throw new WorkflowError("INVALID_STATE", "This step is already blocked.");
      const from = s.status;
      s.blockedPrevStatus = from;
      s.status = "blocked";
      s.blockedReason = reason;
      s.blockedAt = ctx.now;
      run.event("step_blocked", s, { reason }, from, "blocked");
      run.notifyAdmins("step_blocked", s, { reason });
      return;
    }

    case "unblock": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      if (s.status !== "blocked") throw new WorkflowError("INVALID_STATE", "This step isn't blocked.");
      const note = optionalText(command.note, MAX_NOTE);
      const to = s.blockedPrevStatus ?? "not_started";
      const reason = s.blockedReason;
      s.status = to;
      s.blockedReason = null;
      s.blockedAt = null;
      s.blockedPrevStatus = null;
      run.event("step_unblocked", s, { note, wasBlockedFor: reason }, "blocked", to);
      run.notify(s.assigneeId, "step_unblocked", s, { note });
      run.notifyAdmins("step_unblocked", s, { note, wasBlockedFor: reason });
      return;
    }

    case "sendBack": {
      const [from, fi] = run.step(command.fromStepId);
      const [to, ti] = run.step(command.toStepId);
      run.requireCanAct(from, fi);
      if (ti >= fi) throw new WorkflowError("VALIDATION", "A unit can only be sent back to an earlier step.");
      if (!isFinished(to.status)) {
        throw new WorkflowError("INVALID_STATE", `${to.name} isn't finished, so there's nothing to send back.`);
      }
      const reason = requireText(command.reason, MAX_REASON, "Say what needs fixing.");

      const reopened = [to];
      if (command.reopenBetween !== false) {
        for (let j = ti + 1; j < fi; j++) if (t.steps[j].status === "done") reopened.push(t.steps[j]);
      }
      // A manager sending back from a step that's already finished: it has to happen again too.
      if (isFinished(from.status)) reopened.push(from);
      run.event("sent_back", from, {
        toStepId: to.id,
        toStepName: to.name,
        reason,
        reopenedStepIds: reopened.map((r) => r.id),
      });
      for (const r of reopened) {
        const previous = reopenStep(run, r);
        run.event("step_reopened", r, { reason, sentBackFrom: from.name }, previous, "not_started");
      }
      to.reworkCount += 1;
      run.newChecklistItem(to, `Sent back from ${from.name}: ${reason}`, { source: "send_back" });

      // The sender waits for the reopened work, unless it runs alongside it.
      if (!isFinished(from.status) && !isStepReady(t.steps, fi)) {
        const previous = from.status;
        from.status = "not_started";
        from.startedAt = null;
        from.blockedReason = null;
        from.blockedAt = null;
        from.blockedPrevStatus = null;
        clearBooking(from);
        if (previous !== "not_started") run.event("step_reset", from, { reason: "Sent back" }, previous, "not_started");
      }
      run.hints.set(to.id, { reason: "sent_back", data: { fromStepName: from.name, reason } });
      run.notifyAdmins("send_back_alert", from, { toStepName: to.name, reason });
      return;
    }

    case "reassign": {
      run.requireAdmin("reassign a step");
      const [s, i] = run.step(command.stepId);
      if (s.assigneeId === command.assigneeId) return;
      if (isFinished(s.status)) throw new WorkflowError("INVALID_STATE", "This step is already finished.");
      const previous = s.assigneeId;
      s.assigneeId = command.assigneeId;
      run.event("step_reassigned", s, { fromPersonId: previous, toPersonId: command.assigneeId });
      if (isStepActive(t.steps, i)) {
        const dedupe = `${s.id}:${s.activationCount}:reassigned:${ctx.now.getTime()}`;
        if (command.assigneeId) run.notify(command.assigneeId, "step_assigned", s, { reassigned: true }, dedupe);
        else run.notifyAdmins("needs_assignee", s, {}, dedupe);
        run.notify(previous, "step_unassigned", s);
      } else if (s.status === "scheduled") {
        run.notify(command.assigneeId, "booking_created", s, { on: s.scheduledOn, time: s.scheduledTime });
        run.notify(previous, "booking_cancelled", s, { on: s.scheduledOn });
      }
      return;
    }

    case "addChecklistItem": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      const text = requireText(command.text, MAX_ITEM, "Write the item first.");
      const state: ChecklistState = command.state ?? "open";
      const done = state === "done";
      const item = run.newChecklistItem(s, text, {
        state,
        doneById: done ? run.actor.personId : null,
        doneAt: done ? ctx.now : null,
      });
      run.event("checklist_item_added", s, { itemId: item.id, text, state });
      return;
    }

    case "setChecklistItemState": {
      const [s, i] = run.step(command.stepId);
      run.requireCanAct(s, i);
      const item = s.checklist.find((c) => c.id === command.itemId);
      if (!item) throw new WorkflowError("NOT_FOUND", "That checklist item doesn't exist.");
      if (item.state === command.state) return;
      if (isFinished(s.status) && !run.isAdmin) {
        throw new WorkflowError("INVALID_STATE", "This step is already finished.");
      }
      const previous = item.state;
      item.state = command.state;
      item.doneById = command.state === "done" ? run.actor.personId : null;
      item.doneAt = command.state === "done" ? ctx.now : null;
      run.event("checklist_item_updated", s, { itemId: item.id, text: item.text, from: previous, to: command.state });
      return;
    }

    case "editChecklistItem": {
      run.requireAdmin("edit checklist items");
      const [s] = run.step(command.stepId);
      const item = s.checklist.find((c) => c.id === command.itemId);
      if (!item) throw new WorkflowError("NOT_FOUND", "That checklist item doesn't exist.");
      const text = requireText(command.text, MAX_ITEM, "Write the item first.");
      if (item.text === text) return;
      const previous = item.text;
      item.text = text;
      run.event("checklist_item_edited", s, { itemId: item.id, from: previous, to: text });
      return;
    }

    case "addNote": {
      const text = requireText(command.text, MAX_NOTE, "Write a note first.");
      if (command.stepId === null) {
        run.requireAdmin("add notes to the turnover");
        run.event("note_added", null, { text });
      } else {
        const [s, i] = run.step(command.stepId);
        run.requireCanAct(s, i);
        run.event("note_added", s, { text });
      }
      return;
    }

    case "updateTurnover": {
      run.requireAdmin("edit a turnover");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of ["moveOutDate", "targetReadyDate"] as const) {
        const value = command[field];
        if (value === undefined || value === t[field]) continue;
        if (value !== null && !isDateOnly(value)) throw new WorkflowError("VALIDATION", "Dates must be real dates.");
        changes[field] = { from: t[field], to: value };
        t[field] = value;
      }
      if (command.notes !== undefined) {
        const notes = optionalText(command.notes ?? undefined, MAX_NOTE) ?? null;
        if (notes !== t.notes) {
          changes.notes = { from: t.notes, to: notes };
          t.notes = notes;
        }
      }
      if (Object.keys(changes).length > 0) run.event("turnover_updated", null, { changes });
      return;
    }
  }
}

/** Applies one command. Throws WorkflowError if a rule is broken; never mutates its input. */
export function applyCommand(input: TurnoverState, command: Command, ctx: EngineContext): EngineResult {
  const t = structuredClone(input);
  const run = new Run(t, ctx);
  handle(run, command);
  if (run.changed) {
    run.syncActivation();
    run.syncCompletion();
    t.version += 1;
  }
  return { turnover: t, events: run.events, notifications: run.notifications, changed: run.changed };
}

export interface NewTurnoverInput {
  id: string;
  propertyId: string;
  unit: string;
  moveOutDate: DateOnly | null;
  /** undefined: use move-out + the default target days. null: no target date. */
  targetReadyDate?: DateOnly | null;
  notes?: string | null;
  steps: StepTemplate[];
  /** Step key → person. */
  assignees: Readonly<Record<string, string | null | undefined>>;
  defaultTargetDays: number | null;
}

/** Builds a new turnover from a template and activates its first step(s). */
export function createTurnoverState(input: NewTurnoverInput, ctx: EngineContext): EngineResult {
  if (!ctx.actor.roles.includes("admin")) throw new WorkflowError("FORBIDDEN", "Only a manager can create a turnover.");
  const unit = requireText(input.unit, 40, "Enter the unit.");
  if (input.steps.length === 0) throw new WorkflowError("VALIDATION", "The workflow template has no steps.");
  for (const d of [input.moveOutDate, input.targetReadyDate]) {
    if (d != null && !isDateOnly(d)) throw new WorkflowError("VALIDATION", "Dates must be real dates.");
  }
  const targetReadyDate =
    input.targetReadyDate !== undefined
      ? input.targetReadyDate
      : input.moveOutDate && input.defaultTargetDays !== null
        ? addDays(input.moveOutDate, input.defaultTargetDays)
        : null;

  const steps: StepState[] = [...input.steps]
    .sort((a, b) => a.position - b.position)
    .map(({ checklist, ...template }) => ({
      ...template,
      id: ctx.newId(),
      status: "not_started",
      assigneeId: input.assignees[template.key] ?? null,
      scheduledOn: null,
      scheduledTime: null,
      dueOn: null,
      activatedAt: null,
      activationCount: 0,
      startedAt: null,
      completedOn: null,
      completedAt: null,
      reopenedOn: null,
      reopenedAt: null,
      blockedReason: null,
      blockedAt: null,
      blockedPrevStatus: null,
      reworkCount: 0,
      checklist: checklist.map((text, position) => ({
        id: ctx.newId(),
        text,
        state: "open",
        source: "template",
        sourceItemId: null,
        position,
        doneById: null,
        doneAt: null,
      })),
    }));

  const t: TurnoverState = {
    id: input.id,
    propertyId: input.propertyId,
    unit,
    moveOutDate: input.moveOutDate,
    targetReadyDate,
    notes: optionalText(input.notes ?? undefined, MAX_NOTE) ?? null,
    completedAt: null,
    version: 1,
    steps,
  };
  const run = new Run(t, ctx);
  run.event("turnover_created", null, { unit, moveOutDate: t.moveOutDate, targetReadyDate });
  run.syncActivation();
  run.syncCompletion();
  return { turnover: t, events: run.events, notifications: run.notifications, changed: true };
}

/** Human wording for a status change, used in timelines. */
export function describeStatusChange(from: StepStatus | null, to: StepStatus | null): string {
  if (!to) return "";
  return from ? `${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}` : STATUS_LABELS[to];
}
