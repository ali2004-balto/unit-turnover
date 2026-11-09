/**
 * Builders for workflow tests: a cast of people, a fixed clock, and a way to
 * walk a turnover through commands.
 */
import { addDays, type DateOnly } from "../dates";
import { DEFAULT_TEMPLATE_STEPS } from "./default-template";
import { applyCommand, createTurnoverState } from "./engine";
import type { Actor, Command, EngineContext, EngineResult, Role, StepTemplate, TurnoverState } from "./types";

export const PEOPLE = {
  admin: "admin-1",
  admin2: "admin-2",
  inspector: "inspector-1",
  crew: "crew-1",
  crew2: "crew-2",
  cleaner: "cleaner-1",
  photographer: "photographer-1",
  leasing: "leasing-1",
} as const;

export const ADMIN_IDS = [PEOPLE.admin, PEOPLE.admin2];

export const DEFAULT_ASSIGNEES: Record<string, string> = {
  inspection: PEOPLE.inspector,
  scope: PEOPLE.admin,
  work: PEOPLE.crew,
  cleaning: PEOPLE.cleaner,
  photos: PEOPLE.photographer,
  leasing: PEOPLE.leasing,
};

const ROLE_OF: Record<string, Role> = {
  [PEOPLE.admin]: "admin",
  [PEOPLE.admin2]: "admin",
  [PEOPLE.inspector]: "inspector",
  [PEOPLE.crew]: "crew",
  [PEOPLE.crew2]: "crew",
  [PEOPLE.cleaner]: "cleaner",
  [PEOPLE.photographer]: "photographer",
  [PEOPLE.leasing]: "leasing",
};

export function actor(personId: string): Actor {
  return { personId, roles: [ROLE_OF[personId]] };
}

export const START_DAY: DateOnly = "2026-11-02";

/** A test clock: day 0 is START_DAY at 9am Pacific (17:00 UTC). */
export class Clock {
  day = 0;
  private seq = 0;
  get today(): DateOnly {
    return addDays(START_DAY, this.day);
  }
  get now(): Date {
    // Each read moves forward a second so events keep their order.
    this.seq += 1;
    return new Date(Date.parse(`${this.today}T17:00:00Z`) + this.seq * 1000);
  }
  advance(days: number): void {
    this.day += days;
  }
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

export function context(clock: Clock, by: Actor): EngineContext {
  return { actor: by, now: clock.now, today: clock.today, adminIds: ADMIN_IDS, newId };
}

export function templateSteps(overrides: Partial<Record<string, Partial<StepTemplate>>> = {}): StepTemplate[] {
  return DEFAULT_TEMPLATE_STEPS.map((s) => ({ ...s, ...overrides[s.key], checklist: [...(overrides[s.key]?.checklist ?? s.checklist)] }));
}

/** A turnover plus a running log of every event and notification, for assertions. */
export class Scenario {
  t: TurnoverState;
  last: EngineResult;
  readonly clock: Clock;

  constructor(opts: {
    clock?: Clock;
    moveOutDate?: DateOnly | null;
    targetReadyDate?: DateOnly | null;
    steps?: StepTemplate[];
    assignees?: Record<string, string | null>;
  } = {}) {
    this.clock = opts.clock ?? new Clock();
    this.last = createTurnoverState(
      {
        id: "turnover-1",
        propertyId: "property-1",
        unit: "203",
        moveOutDate: opts.moveOutDate === undefined ? START_DAY : opts.moveOutDate,
        targetReadyDate: opts.targetReadyDate,
        steps: opts.steps ?? templateSteps(),
        assignees: opts.assignees ?? DEFAULT_ASSIGNEES,
        defaultTargetDays: 10,
      },
      context(this.clock, actor(PEOPLE.admin)),
    );
    this.t = this.last.turnover;
  }

  step(key: string) {
    const s = this.t.steps.find((x) => x.key === key);
    if (!s) throw new Error(`no step ${key}`);
    return s;
  }

  run(by: string, command: Command): EngineResult {
    this.last = applyCommand(this.t, command, context(this.clock, actor(by)));
    this.t = this.last.turnover;
    return this.last;
  }

  /** The assignee (or a manager) finishes a step, ticking any open checklist items first. */
  finish(key: string, by?: string): EngineResult {
    const s = this.step(key);
    const who = by ?? s.assigneeId ?? PEOPLE.admin;
    for (const item of s.checklist.filter((c) => c.state === "open")) {
      if (s.requireChecklist) this.run(who, { type: "setChecklistItemState", stepId: s.id, itemId: item.id, state: "done" });
    }
    return this.run(who, { type: "complete", stepId: s.id });
  }

  notified(kind?: string): Array<{ to: string; kind: string; data: Record<string, unknown> }> {
    return this.last.notifications
      .filter((n) => !kind || n.kind === kind)
      .map((n) => ({ to: n.recipientId, kind: n.kind, data: n.data }));
  }

  statuses(): Record<string, string> {
    return Object.fromEntries(this.t.steps.map((s) => [s.key, s.status]));
  }
}
