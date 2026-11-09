import type { DateOnly } from "../dates";
import type { StepStatus } from "../status";

export const ROLES = ["admin", "inspector", "crew", "cleaner", "photographer", "leasing"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Manager",
  inspector: "Inspector",
  crew: "In-house employee",
  cleaner: "Cleaner",
  photographer: "Photographer",
  leasing: "Leasing",
};

/**
 * Steps with special behaviour. "scope" turns its checklist into the work
 * step's checklist when approved; "work" receives it (and is skipped as N/A
 * when the approved scope is empty).
 */
export const STEP_KINDS = ["inspection", "scope", "work", "standard"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const CHECKLIST_STATES = ["open", "done", "to_confirm", "dropped"] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];

export const CHECKLIST_SOURCES = ["template", "scope", "send_back", "manual", "import", "inspection"] as const;
export type ChecklistSource = (typeof CHECKLIST_SOURCES)[number];

export interface ChecklistItem {
  id: string;
  text: string;
  state: ChecklistState;
  source: ChecklistSource;
  /** For items copied from the scope: the scope item they came from. */
  sourceItemId: string | null;
  position: number;
  doneById: string | null;
  doneAt: Date | null;
}

/** One step of a workflow template, stored as data. */
export interface StepTemplate {
  /** Stable identifier, e.g. "cleaning". Per-property default assignees use it. */
  key: string;
  name: string;
  position: number;
  /** Runs at the same time as the step before it; the next step waits for both. */
  parallelWithPrevious: boolean;
  role: Role;
  kind: StepKind;
  allowNa: boolean;
  /** The assignee must tick off every checklist item before marking the step Done. */
  requireChecklist: boolean;
  /** Days after the step becomes active that it is due. */
  dueDays: number | null;
  /** Alert managers when the step has been active this many days. */
  escalateAfterDays: number | null;
  /** Default checklist items. */
  checklist: string[];
}

/** One thing the inspector found. Findings that need work become scope items. */
export interface InspectionFinding {
  id: string;
  room: string;
  description: string;
  needsWork: boolean;
}

export interface StepState extends Omit<StepTemplate, "checklist"> {
  id: string;
  status: StepStatus;
  assigneeId: string | null;
  /** Booking date and optional time ("09:30"), in the business time zone. */
  scheduledOn: DateOnly | null;
  scheduledTime: string | null;
  dueOn: DateOnly | null;
  /** When the step last became the assignee's turn. null while waiting. */
  activatedAt: Date | null;
  activationCount: number;
  startedAt: Date | null;
  /** The step's date in the sheet: when it was finished (Done or N/A). */
  completedOn: DateOnly | null;
  completedAt: Date | null;
  /** When a send-back last reopened the step. */
  reopenedOn: DateOnly | null;
  reopenedAt: Date | null;
  blockedReason: string | null;
  blockedAt: Date | null;
  blockedPrevStatus: StepStatus | null;
  reworkCount: number;
  checklist: ChecklistItem[];
}

export interface TurnoverState {
  id: string;
  propertyId: string;
  unit: string;
  moveOutDate: DateOnly | null;
  targetReadyDate: DateOnly | null;
  notes: string | null;
  completedAt: Date | null;
  version: number;
  /** Always in workflow order. */
  steps: StepState[];
}

export interface Actor {
  /** null for the system itself (imports, scheduled jobs). */
  personId: string | null;
  roles: readonly Role[];
}

export const SYSTEM_ACTOR: Actor = { personId: null, roles: ["admin"] };

export interface EngineContext {
  actor: Actor;
  now: Date;
  /** Today's date in the business time zone. */
  today: DateOnly;
  /** Managers to alert about blocks, send-backs and unassigned steps. */
  adminIds: readonly string[];
  newId: () => string;
}

export type Command =
  | { type: "start"; stepId: string }
  | { type: "schedule"; stepId: string; on: DateOnly; time?: string | null }
  | { type: "unschedule"; stepId: string }
  | {
      type: "complete";
      stepId: string;
      note?: string;
      /** For an inspection step: what was found. Filled in by the server from the database, never by a form. */
      findings?: InspectionFinding[];
    }
  | { type: "markNa"; stepId: string; reason?: string }
  | { type: "block"; stepId: string; reason: string }
  | { type: "unblock"; stepId: string; note?: string }
  | { type: "sendBack"; fromStepId: string; toStepId: string; reason: string; reopenBetween?: boolean }
  | { type: "reassign"; stepId: string; assigneeId: string | null }
  | { type: "addChecklistItem"; stepId: string; text: string; state?: ChecklistState }
  | { type: "setChecklistItemState"; stepId: string; itemId: string; state: ChecklistState }
  | { type: "editChecklistItem"; stepId: string; itemId: string; text: string }
  | { type: "addNote"; stepId: string | null; text: string }
  | {
      type: "updateTurnover";
      moveOutDate?: DateOnly | null;
      targetReadyDate?: DateOnly | null;
      notes?: string | null;
    };

export const NOTIFICATION_KINDS = [
  /** A step became this person's turn. */
  "step_assigned",
  /** A step they were booked for is now ready (the step before finished). */
  "step_ready_booked",
  /** A later step sent the unit back to them. */
  "step_sent_back",
  /** Managers: a step became active with nobody assigned. */
  "needs_assignee",
  /** They were booked for a future step. */
  "booking_created",
  /** Their booking was cancelled or moved to someone else. */
  "booking_cancelled",
  /** A manager booked their active step for a date. */
  "step_scheduled",
  /** Their active task was moved to someone else. */
  "step_unassigned",
  /** Their active task is no longer needed (marked N/A). */
  "step_cancelled",
  /** Managers: a step was blocked. */
  "step_blocked",
  /** A blocked step is clear again. */
  "step_unblocked",
  /** Managers: a unit was sent back. */
  "send_back_alert",
  /** Managers: every step is Done or N/A. */
  "turnover_completed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface EventDraft {
  type: string;
  stepId: string | null;
  actorId: string | null;
  fromStatus: StepStatus | null;
  toStatus: StepStatus | null;
  data: Record<string, unknown>;
  at: Date;
}

export interface NotificationDraft {
  recipientId: string;
  kind: NotificationKind;
  stepId: string | null;
  data: Record<string, unknown>;
  /** Prevents the same notification being queued twice. */
  dedupeKey: string | null;
}

export interface EngineResult {
  turnover: TurnoverState;
  events: EventDraft[];
  notifications: NotificationDraft[];
  /** False when the command changed nothing (e.g. starting a step already in progress). */
  changed: boolean;
}
