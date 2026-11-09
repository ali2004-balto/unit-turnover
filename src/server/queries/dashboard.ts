/**
 * Turns the list of turnovers into what the dashboard shows: one card per
 * unit, the board's columns, the filters, and the Summary tab numbers.
 * Pure, so it's tested without a database.
 */
import { daysBetween } from "@/domain/dates";
import { COMPLETE, FLAGS, type Flag, stageLabel } from "@/domain/derived";
import type { StepStatus } from "@/domain/status";
import { type Summary, summarize } from "@/domain/summary";
import { isStepActive, isStepUpcomingBooking } from "@/domain/workflow/engine";
import type { StepTemplate } from "@/domain/workflow/types";
import type { TurnoverList, TurnoverView } from "./turnovers";

export interface DashboardFilters {
  property?: string;
  assignee?: string;
  /** A step key, or "complete". */
  stage?: string;
  flag?: Flag;
  q?: string;
  showComplete?: boolean;
  missingMoveOut?: boolean;
}

export interface ActiveStepView {
  id: string;
  key: string;
  name: string;
  status: StepStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  scheduledOn: string | null;
  scheduledTime: string | null;
  dueOn: string | null;
  /** The step's own due date has passed. */
  late: boolean;
  /** Booked for a day that has passed and still not started. */
  bookingPassed: boolean;
}

export interface CardView {
  id: string;
  propertyName: string;
  unit: string;
  flag: Flag;
  pastTarget: boolean;
  currentStage: string;
  /** Board column: the current step's key, or "complete". */
  columnKey: string;
  daysVacant: number | null;
  daysInStage: number | null;
  moveOutDate: string | null;
  targetReadyDate: string | null;
  activeSteps: ActiveStepView[];
  blockers: Array<{ stepName: string; reason: string }>;
  upcomingBookings: Array<{ stepName: string; on: string }>;
  reworkCount: number;
  notes: string | null;
}

export interface Dashboard {
  today: string;
  dueSoonDays: number;
  cards: CardView[];
  totalCards: number;
  columns: Array<{ key: string; label: string }>;
  summary: Summary;
  options: {
    properties: Array<{ id: string; name: string }>;
    assignees: Array<{ id: string; name: string }>;
    stages: Array<{ key: string; label: string }>;
    flags: readonly Flag[];
  };
}

const FLAG_ORDER: Record<Flag, number> = {
  Overdue: 0,
  Blocked: 1,
  "Due soon": 2,
  "On track": 3,
  "No target date": 4,
  Complete: 5,
};

export function parseFilters(params: Record<string, string | string[] | undefined>): DashboardFilters {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  const flag = one("flag");
  return {
    property: one("property"),
    assignee: one("assignee"),
    stage: one("stage"),
    flag: FLAGS.includes(flag as Flag) ? (flag as Flag) : undefined,
    q: one("q")?.slice(0, 50),
    showComplete: one("complete") === "1",
    missingMoveOut: one("missing") === "moveout",
  };
}

function toCard(row: TurnoverView, list: TurnoverList): CardView {
  const { turnover: t, derived } = row;
  const nameOf = (id: string | null) => (id ? (list.people.get(id)?.name ?? null) : null);
  const activeSteps = t.steps
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => isStepActive(t.steps, i))
    .map(
      ({ s }): ActiveStepView => ({
        id: s.id,
        key: s.key,
        name: s.name,
        status: s.status,
        assigneeId: s.assigneeId,
        assigneeName: nameOf(s.assigneeId),
        scheduledOn: s.scheduledOn,
        scheduledTime: s.scheduledTime,
        dueOn: s.dueOn,
        late: s.dueOn !== null && daysBetween(list.today, s.dueOn) > 0,
        bookingPassed: s.status === "scheduled" && s.scheduledOn !== null && daysBetween(list.today, s.scheduledOn) > 0,
      }),
    );
  return {
    id: t.id,
    propertyName: row.propertyName,
    unit: t.unit,
    flag: derived.flag,
    pastTarget: row.pastTarget,
    currentStage: derived.currentStage,
    columnKey: derived.isComplete ? "complete" : t.steps[derived.currentStepIndex!].key,
    daysVacant: derived.daysVacant,
    daysInStage: derived.daysInStage,
    moveOutDate: t.moveOutDate,
    targetReadyDate: t.targetReadyDate,
    activeSteps,
    blockers: t.steps.filter((s) => s.status === "blocked").map((s) => ({ stepName: s.name, reason: s.blockedReason ?? "" })),
    upcomingBookings: t.steps
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => isStepUpcomingBooking(t.steps, i))
      .map(({ s }) => ({ stepName: s.name, on: s.scheduledOn! })),
    reworkCount: t.steps.reduce((n, s) => n + s.reworkCount, 0),
    notes: t.notes,
  };
}

function matches(card: CardView, filters: DashboardFilters, propertyId: string, moveOut: string | null): boolean {
  if (filters.property && propertyId !== filters.property) return false;
  if (filters.assignee) {
    const ids = card.activeSteps.map((s) => s.assigneeId ?? "none");
    if (!ids.includes(filters.assignee)) return false;
  }
  if (filters.stage && card.columnKey !== filters.stage) return false;
  if (filters.flag && card.flag !== filters.flag) return false;
  if (filters.missingMoveOut && moveOut !== null) return false;
  if (filters.q) {
    const text = `${card.propertyName} ${card.unit}`.toLowerCase();
    if (!filters.q.toLowerCase().split(/\s+/).every((word) => text.includes(word))) return false;
  }
  const askedForComplete = filters.showComplete || filters.flag === "Complete" || filters.stage === "complete";
  if (card.flag === "Complete" && !askedForComplete) return false;
  return true;
}

export function compareCards(a: CardView, b: CardView): number {
  return (
    FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] ||
    (b.daysInStage ?? -1) - (a.daysInStage ?? -1) ||
    a.propertyName.localeCompare(b.propertyName) ||
    a.unit.localeCompare(b.unit, undefined, { numeric: true })
  );
}

export function buildDashboard(list: TurnoverList, templateSteps: StepTemplate[], filters: DashboardFilters): Dashboard {
  const nameOf = (id: string | null) => (id ? (list.people.get(id)?.name ?? null) : null);
  const all = list.rows.map((row) => ({ row, card: toCard(row, list) }));
  const cards = all
    .filter(({ row, card }) => matches(card, filters, row.turnover.propertyId, row.turnover.moveOutDate))
    .map(({ card }) => card)
    .sort(compareCards);

  const crewNames = [...list.people.values()]
    .filter((p) => p.roles.includes("crew"))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  const summary = summarize(
    list.rows.map((r) => ({
      derived: r.derived,
      moveOutDate: r.turnover.moveOutDate,
      work: r.turnover.steps.filter((s) => s.kind === "work").map((s) => ({ assigneeName: nameOf(s.assigneeId), status: s.status })),
    })),
    templateSteps.map((s, i) => stageLabel(i, s.name)),
    crewNames,
  );

  const columns = templateSteps.map((s, i) => ({ key: s.key, label: stageLabel(i, s.name) }));
  const extraKeys = [...new Set(all.map(({ card }) => card.columnKey))].filter(
    (k) => k !== "complete" && !columns.some((c) => c.key === k),
  );
  for (const key of extraKeys) {
    const card = all.find(({ card }) => card.columnKey === key)!.card;
    columns.push({ key, label: card.currentStage });
  }

  const properties = new Map(list.rows.map((r) => [r.turnover.propertyId, { id: r.turnover.propertyId, name: r.propertyName, order: r.propertySortOrder }]));
  const assignees = new Map<string, string>();
  for (const { card } of all) for (const s of card.activeSteps) if (s.assigneeId && s.assigneeName) assignees.set(s.assigneeId, s.assigneeName);

  return {
    today: list.today,
    dueSoonDays: list.settings.dueSoonDays,
    cards,
    totalCards: all.length,
    columns,
    summary,
    options: {
      properties: [...properties.values()].sort((a, b) => a.order - b.order).map(({ id, name }) => ({ id, name })),
      assignees: [...assignees].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      stages: [...columns, { key: "complete", label: COMPLETE }],
      flags: FLAGS,
    },
  };
}
