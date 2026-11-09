import { beforeEach, describe, expect, it } from "vitest";
import { derive } from "../derived";
import { applyCommand, createTurnoverState, isStepActive, isStepUpcomingBooking, turnoverDerivedInput } from "./engine";
import { WorkflowError } from "./errors";
import { actor, Clock, context, DEFAULT_ASSIGNEES, PEOPLE, Scenario, START_DAY, templateSteps } from "./test-helpers";
import type { Command } from "./types";

const { admin, admin2, inspector, crew, crew2, cleaner, photographer, leasing } = PEOPLE;

function expectRule(fn: () => unknown, code: WorkflowError["code"], message?: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WorkflowError);
    expect((e as WorkflowError).code).toBe(code);
    if (message) expect((e as WorkflowError).message).toMatch(message);
    return;
  }
  throw new Error(`expected a ${code} WorkflowError`);
}

const stageOf = (s: Scenario) => derive(turnoverDerivedInput(s.t), s.clock.today, 3);

/** Inspection done, scope approved with the given items: the unit is at in-house work. */
function atWork(s: Scenario, scopeItems = ["Junk removal", "Touch up paint"]) {
  s.finish("inspection");
  for (const text of scopeItems) s.run(admin, { type: "addChecklistItem", stepId: s.step("scope").id, text });
  s.finish("scope");
}

describe("creating a turnover", () => {
  it("copies the template's six steps in order, with each property's default assignees", () => {
    const s = new Scenario();
    expect(s.t.steps.map((x) => [x.name, x.assigneeId])).toEqual([
      ["Inspection", inspector],
      ["Scope of work", admin],
      ["In-house work", crew],
      ["Cleaning", cleaner],
      ["Photos", photographer],
      ["Leasing upload", leasing],
    ]);
    expect(Object.values(s.statuses())).toEqual(Array(6).fill("not_started"));
  });

  it("defaults the target ready date to move-out + 10 days, unless told otherwise", () => {
    expect(new Scenario({ moveOutDate: "2026-11-02" }).t.targetReadyDate).toBe("2026-11-12");
    expect(new Scenario({ moveOutDate: "2026-11-02", targetReadyDate: "2026-11-20" }).t.targetReadyDate).toBe("2026-11-20");
    expect(new Scenario({ moveOutDate: "2026-11-02", targetReadyDate: null }).t.targetReadyDate).toBeNull();
    expect(new Scenario({ moveOutDate: null }).t.targetReadyDate).toBeNull();
  });

  it("activates only the first step and texts its assignee", () => {
    const s = new Scenario();
    expect(s.t.steps.map((_, i) => isStepActive(s.t.steps, i))).toEqual([true, false, false, false, false, false]);
    expect(s.notified()).toEqual([
      { to: inspector, kind: "step_assigned", data: expect.objectContaining({ unit: "203", stepName: "Inspection" }) },
    ]);
    expect(s.step("inspection").dueOn).toBe("2026-11-04"); // due 2 days after it becomes active
    expect(s.last.events.map((e) => e.type)).toEqual(["turnover_created", "step_activated"]);
  });

  it("alerts managers when the first step has nobody assigned", () => {
    const s = new Scenario({ assignees: { ...DEFAULT_ASSIGNEES, inspection: null } });
    expect(s.notified()).toEqual([
      { to: admin2, kind: "needs_assignee", data: expect.objectContaining({ stepName: "Inspection" }) },
    ]);
  });

  it("only managers can create turnovers", () => {
    const clock = new Clock();
    const input = {
      id: "t-2",
      propertyId: "p",
      unit: "101",
      moveOutDate: START_DAY,
      steps: templateSteps(),
      assignees: DEFAULT_ASSIGNEES,
      defaultTargetDays: 10,
    };
    expectRule(() => createTurnoverState(input, context(clock, actor(crew))), "FORBIDDEN", /Only a manager/);
    expect(createTurnoverState(input, context(clock, actor(admin))).turnover.unit).toBe("101");
  });

  it("refuses a blank unit or a bad date", () => {
    const clock = new Clock();
    const base = { id: "t-3", propertyId: "p", steps: templateSteps(), assignees: {}, defaultTargetDays: 10 };
    expectRule(() => createTurnoverState({ ...base, unit: " ", moveOutDate: null }, context(clock, actor(admin))), "VALIDATION");
    expectRule(() => createTurnoverState({ ...base, unit: "1", moveOutDate: "2026-11-31" }, context(clock, actor(admin))), "VALIDATION");
  });
});

describe("sequential handoff", () => {
  it("hands the unit to the next person when a step is Done", () => {
    const s = new Scenario();
    s.clock.advance(1);
    s.finish("inspection");
    expect(s.step("inspection")).toMatchObject({ status: "done", completedOn: "2026-11-03" });
    expect(isStepActive(s.t.steps, 1)).toBe(true);
    expect(s.notified()).toEqual([{ to: admin, kind: "step_assigned", data: expect.objectContaining({ stepName: "Scope of work" }) }]);
    expect(stageOf(s).currentStage).toBe("2. Scope of work");
  });

  it("walks a unit all the way to Complete, matching the sheet's numbers", () => {
    const s = new Scenario({ moveOutDate: START_DAY });
    const handoffs: string[] = [];
    s.clock.advance(1);
    s.finish("inspection");
    for (const text of ["Junk removal", "Touch up paint"]) s.run(admin, { type: "addChecklistItem", stepId: s.step("scope").id, text });
    s.finish("scope");
    handoffs.push(...s.notified().map((n) => `${n.kind}→${n.to}`));
    s.clock.advance(3);
    s.finish("work");
    handoffs.push(...s.notified().map((n) => `${n.kind}→${n.to}`));
    s.clock.advance(1);
    s.finish("cleaning");
    handoffs.push(...s.notified().map((n) => `${n.kind}→${n.to}`));
    s.clock.advance(1);
    s.finish("photos");
    handoffs.push(...s.notified().map((n) => `${n.kind}→${n.to}`));
    s.clock.advance(2);
    s.finish("leasing");
    handoffs.push(...s.notified().map((n) => `${n.kind}→${n.to}`));

    expect(handoffs).toEqual([
      `step_assigned→${crew}`,
      `step_assigned→${cleaner}`,
      `step_assigned→${photographer}`,
      `step_assigned→${leasing}`,
      `turnover_completed→${admin}`,
      `turnover_completed→${admin2}`,
    ]);
    expect(s.t.completedAt).not.toBeNull();
    const d = derive(turnoverDerivedInput(s.t), "2026-12-01", 3);
    expect(d).toMatchObject({ currentStage: "Complete", flag: "Complete", daysVacant: 8, daysInStage: null });
  });

  it("logs every change with who did it and the status change", () => {
    const s = new Scenario();
    s.run(inspector, { type: "start", stepId: s.step("inspection").id });
    expect(s.last.events).toEqual([
      expect.objectContaining({ type: "step_started", actorId: inspector, fromStatus: "not_started", toStatus: "in_progress" }),
    ]);
  });

  it("ignores repeated taps: starting a step that's already in progress changes nothing", () => {
    const s = new Scenario();
    s.run(inspector, { type: "start", stepId: s.step("inspection").id });
    const before = s.t;
    const result = s.run(inspector, { type: "start", stepId: s.step("inspection").id });
    expect(result.changed).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.turnover.version).toBe(before.version);
  });

  it("never changes the state it was given", () => {
    const s = new Scenario();
    const snapshot = structuredClone(s.t);
    applyCommand(s.t, { type: "complete", stepId: s.step("inspection").id }, context(s.clock, actor(inspector)));
    expect(s.t).toEqual(snapshot);
  });
});

describe("who can do what (checked by the engine, not the screen)", () => {
  it("people can't touch tasks that aren't theirs", () => {
    const s = new Scenario();
    expectRule(() => s.run(cleaner, { type: "complete", stepId: s.step("inspection").id }), "FORBIDDEN", /isn't assigned to you/);
  });

  it("people can't act on their step before it's their turn", () => {
    const s = new Scenario();
    expectRule(() => s.run(cleaner, { type: "start", stepId: s.step("cleaning").id }), "FORBIDDEN", /turn/);
  });

  it("managers can act on any step", () => {
    const s = new Scenario();
    s.run(admin, { type: "complete", stepId: s.step("inspection").id });
    expect(s.step("inspection").status).toBe("done");
  });

  it.each<[string, Command | ((s: Scenario) => Command)]>([
    ["mark a step N/A", (s) => ({ type: "markNa", stepId: s.step("inspection").id })],
    ["reassign a step", (s) => ({ type: "reassign", stepId: s.step("inspection").id, assigneeId: crew })],
    ["edit checklist items", (s) => ({ type: "editChecklistItem", stepId: s.step("cleaning").id, itemId: s.step("cleaning").checklist[0].id, text: "x" })],
    ["edit a turnover", { type: "updateTurnover", targetReadyDate: "2026-12-01" }],
    ["add notes to the turnover", { type: "addNote", stepId: null, text: "hi" }],
  ])("only a manager can %s", (_what, make) => {
    const s = new Scenario();
    const command = typeof make === "function" ? make(s) : make;
    expectRule(() => s.run(inspector, command), "FORBIDDEN", /Only a manager/);
  });
});

describe("scope of work → in-house work checklist", () => {
  it("copies the approved scope to the work step, keeping 'to confirm' items and leaving out dropped ones", () => {
    const s = new Scenario();
    s.finish("inspection");
    const scope = s.step("scope");
    for (const text of ["New light switch covers", "Sand and repaint vanity cupboards", "Fix fence"]) {
      s.run(admin, { type: "addChecklistItem", stepId: scope.id, text });
    }
    const [, vanity, fence] = s.step("scope").checklist;
    s.run(admin, { type: "setChecklistItemState", stepId: scope.id, itemId: vanity.id, state: "to_confirm" });
    s.run(admin, { type: "setChecklistItemState", stepId: scope.id, itemId: fence.id, state: "dropped" });
    s.finish("scope");
    expect(s.step("work").checklist.map((c) => [c.text, c.state, c.source])).toEqual([
      ["New light switch covers", "open", "scope"],
      ["Sand and repaint vanity cupboards", "to_confirm", "scope"],
    ]);
  });

  it("won't let the employee mark work Done with items still open, but 'to confirm' items don't block it", () => {
    const s = new Scenario();
    atWork(s);
    const work = s.step("work");
    s.run(admin, { type: "setChecklistItemState", stepId: work.id, itemId: work.checklist[1].id, state: "to_confirm" });
    expectRule(() => s.run(crew, { type: "complete", stepId: work.id }), "CHECKLIST_INCOMPLETE", /1 checklist item is still open/);
    s.run(crew, { type: "setChecklistItemState", stepId: work.id, itemId: work.checklist[0].id, state: "done" });
    s.run(crew, { type: "complete", stepId: work.id });
    expect(s.step("work").status).toBe("done");
    expect(s.step("work").checklist[0].doneById).toBe(crew);
  });

  it("lets a manager override an unfinished checklist", () => {
    const s = new Scenario();
    atWork(s);
    s.run(admin, { type: "complete", stepId: s.step("work").id });
    expect(s.step("work").status).toBe("done");
  });
});

describe("N/A skipping", () => {
  it("skips in-house work when the inspection finds nothing, and goes straight to cleaning", () => {
    const s = new Scenario();
    s.finish("inspection");
    s.finish("scope"); // approved with no items
    expect(s.step("work")).toMatchObject({ status: "na", completedOn: START_DAY });
    expect(s.last.events.find((e) => e.type === "step_skipped")?.data).toMatchObject({ automatic: true });
    expect(isStepActive(s.t.steps, 3)).toBe(true);
    expect(s.notified()).toEqual([{ to: cleaner, kind: "step_assigned", data: expect.anything() }]);
    expect(stageOf(s).currentStage).toBe("4. Cleaning");
  });

  it("skips a later step a manager marked N/A ahead of time", () => {
    const s = new Scenario();
    s.run(admin, { type: "markNa", stepId: s.step("photos").id, reason: "Photos from last turn are still good" });
    expect(s.notified()).toEqual([]); // the photographer had nothing booked, so isn't told
    atWork(s);
    s.finish("work");
    s.finish("cleaning");
    expect(s.notified()).toEqual([{ to: leasing, kind: "step_assigned", data: expect.anything() }]);
    expect(stageOf(s).currentStage).toBe("6. Leasing upload");
  });

  it("tells the assignee when their active task is no longer needed", () => {
    const s = new Scenario();
    s.run(admin, { type: "markNa", stepId: s.step("inspection").id });
    expect(s.notified("step_cancelled")).toEqual([{ to: inspector, kind: "step_cancelled", data: expect.anything() }]);
  });

  it("refuses N/A on a step the template says is required", () => {
    const s = new Scenario({ steps: templateSteps({ leasing: { allowNa: false } }) });
    expectRule(() => s.run(admin, { type: "markNa", stepId: s.step("leasing").id }), "INVALID_STATE", /can't be marked N\/A/);
  });
});

describe("blocked", () => {
  it("requires a reason, alerts managers, and shows Blocked on the flag", () => {
    const s = new Scenario();
    atWork(s);
    const work = s.step("work");
    s.run(crew, { type: "start", stepId: work.id });
    expectRule(() => s.run(crew, { type: "block", stepId: work.id, reason: "  " }), "VALIDATION", /waiting on/);
    s.run(crew, { type: "block", stepId: work.id, reason: "Waiting on replacement stove" });
    expect(s.step("work")).toMatchObject({ status: "blocked", blockedReason: "Waiting on replacement stove", blockedPrevStatus: "in_progress" });
    expect(s.notified()).toEqual([
      { to: admin, kind: "step_blocked", data: expect.objectContaining({ reason: "Waiting on replacement stove" }) },
      { to: admin2, kind: "step_blocked", data: expect.anything() },
    ]);
    expect(stageOf(s).flag).toBe("Blocked");
  });

  it("keeps the clock running while blocked", () => {
    const s = new Scenario({ moveOutDate: START_DAY });
    atWork(s);
    s.run(crew, { type: "block", stepId: s.step("work").id, reason: "No access" });
    s.clock.advance(5);
    expect(stageOf(s)).toMatchObject({ daysVacant: 5, daysInStage: 5, flag: "Blocked" });
  });

  it("unblocking restores the previous status and tells the assignee and managers", () => {
    const s = new Scenario();
    atWork(s);
    const work = s.step("work");
    s.run(crew, { type: "start", stepId: work.id });
    s.run(crew, { type: "block", stepId: work.id, reason: "Parts" });
    s.run(admin, { type: "unblock", stepId: work.id, note: "Parts arrived" });
    expect(s.step("work")).toMatchObject({ status: "in_progress", blockedReason: null });
    expect(s.notified().map((n) => `${n.kind}→${n.to}`)).toEqual([`step_unblocked→${crew}`, `step_unblocked→${admin2}`]);
  });

  it("can be completed straight from Blocked, which clears the block", () => {
    const s = new Scenario();
    s.run(inspector, { type: "block", stepId: s.step("inspection").id, reason: "No key" });
    s.run(inspector, { type: "complete", stepId: s.step("inspection").id });
    expect(s.step("inspection")).toMatchObject({ status: "done", blockedReason: null, blockedPrevStatus: null });
  });
});

describe("send-back", () => {
  function atPhotos() {
    const s = new Scenario({ moveOutDate: START_DAY });
    atWork(s);
    s.clock.advance(3);
    s.finish("work");
    s.clock.advance(1);
    s.finish("cleaning");
    s.clock.advance(1);
    s.run(photographer, { type: "start", stepId: s.step("photos").id });
    return s;
  }

  it("returns the unit to work with the reason, reopens cleaning, and makes photos wait", () => {
    const s = atPhotos();
    s.run(photographer, {
      type: "sendBack",
      fromStepId: s.step("photos").id,
      toStepId: s.step("work").id,
      reason: "Scuff on bedroom wall",
    });
    expect(s.statuses()).toMatchObject({ work: "not_started", cleaning: "not_started", photos: "not_started" });
    expect(s.step("work")).toMatchObject({ reworkCount: 1, reopenedOn: "2026-11-07", completedOn: null });
    expect(s.step("work").checklist.at(-1)).toMatchObject({ text: "Sent back from Photos: Scuff on bedroom wall", state: "open", source: "send_back" });
    expect(isStepActive(s.t.steps, 2)).toBe(true);
    expect(isStepActive(s.t.steps, 4)).toBe(false);
    expect(s.notified().map((n) => `${n.kind}→${n.to}`)).toEqual([
      `send_back_alert→${admin}`,
      `send_back_alert→${admin2}`,
      `step_sent_back→${crew}`,
    ]);
    expect(s.notified("step_sent_back")[0].data).toMatchObject({ fromStepName: "Photos", reason: "Scuff on bedroom wall" });
    const d = stageOf(s);
    expect(d.currentStage).toBe("3. In-house work");
    expect(d.daysInStage).toBe(0); // restarts from the send-back
  });

  it("needs the fix ticked off before work can be Done again, then flows forward as normal", () => {
    const s = atPhotos();
    s.run(photographer, { type: "sendBack", fromStepId: s.step("photos").id, toStepId: s.step("work").id, reason: "Scuff" });
    expectRule(() => s.run(crew, { type: "complete", stepId: s.step("work").id }), "CHECKLIST_INCOMPLETE");
    s.finish("work");
    expect(s.notified()).toEqual([{ to: cleaner, kind: "step_assigned", data: expect.anything() }]);
    s.finish("cleaning");
    expect(s.notified()).toEqual([{ to: photographer, kind: "step_assigned", data: expect.anything() }]);
  });

  it("can leave the steps in between alone", () => {
    const s = atPhotos();
    s.run(photographer, {
      type: "sendBack",
      fromStepId: s.step("photos").id,
      toStepId: s.step("work").id,
      reason: "Missing outlet cover",
      reopenBetween: false,
    });
    expect(s.statuses()).toMatchObject({ work: "not_started", cleaning: "done", photos: "not_started" });
    s.finish("work");
    expect(s.notified()).toEqual([{ to: photographer, kind: "step_assigned", data: expect.anything() }]);
  });

  it("only goes backwards, to a finished step, with a reason", () => {
    const s = atPhotos();
    const photos = s.step("photos").id;
    expectRule(() => s.run(photographer, { type: "sendBack", fromStepId: photos, toStepId: s.step("leasing").id, reason: "x" }), "VALIDATION");
    expectRule(() => s.run(photographer, { type: "sendBack", fromStepId: photos, toStepId: s.step("work").id, reason: "" }), "VALIDATION");
    expectRule(() => s.run(cleaner, { type: "sendBack", fromStepId: photos, toStepId: s.step("work").id, reason: "x" }), "FORBIDDEN");
  });

  it("lets a manager reopen a completed turnover", () => {
    const s = atPhotos();
    s.finish("photos");
    s.finish("leasing");
    expect(s.t.completedAt).not.toBeNull();
    s.run(admin, { type: "sendBack", fromStepId: s.step("leasing").id, toStepId: s.step("cleaning").id, reason: "Tenant viewing found dust" });
    expect(s.t.completedAt).toBeNull();
    expect(s.last.events.map((e) => e.type)).toContain("turnover_reopened");
    expect(s.statuses()).toMatchObject({ cleaning: "not_started", photos: "not_started", leasing: "not_started" });
    expect(stageOf(s).currentStage).toBe("4. Cleaning");
  });
});

describe("parallel steps and the join", () => {
  const parallel = () => new Scenario({ steps: templateSteps({ cleaning: { parallelWithPrevious: true } }) });

  it("starts both steps of a parallel group together", () => {
    const s = parallel();
    atWork(s);
    expect(isStepActive(s.t.steps, 2)).toBe(true);
    expect(isStepActive(s.t.steps, 3)).toBe(true);
    expect(s.notified().map((n) => n.to).sort()).toEqual([cleaner, crew].sort());
  });

  it("waits for every step in the group before the next one starts", () => {
    const s = parallel();
    atWork(s);
    s.finish("cleaning");
    expect(s.notified()).toEqual([]);
    expect(isStepActive(s.t.steps, 4)).toBe(false);
    expect(stageOf(s).currentStage).toBe("3. In-house work"); // the sheet's rule: first unfinished step
    s.finish("work");
    expect(s.notified()).toEqual([{ to: photographer, kind: "step_assigned", data: expect.anything() }]);
  });
});

describe("reassigning", () => {
  it("moves an active task to someone else and takes it off the first person's list", () => {
    const s = new Scenario();
    atWork(s);
    s.run(admin, { type: "reassign", stepId: s.step("work").id, assigneeId: crew2 });
    expect(s.notified().map((n) => `${n.kind}→${n.to}`)).toEqual([`step_assigned→${crew2}`, `step_unassigned→${crew}`]);
    expectRule(() => s.run(crew, { type: "start", stepId: s.step("work").id }), "FORBIDDEN");
    s.run(crew2, { type: "start", stepId: s.step("work").id });
    expect(s.step("work").status).toBe("in_progress");
  });

  it("asks managers to pick someone when an active task is unassigned", () => {
    const s = new Scenario();
    s.run(admin, { type: "reassign", stepId: s.step("inspection").id, assigneeId: null });
    expect(s.notified().map((n) => `${n.kind}→${n.to}`)).toEqual([`needs_assignee→${admin2}`, `step_unassigned→${inspector}`]);
  });

  it("doesn't message anyone about a step that isn't their turn yet", () => {
    const s = new Scenario();
    s.run(admin, { type: "reassign", stepId: s.step("cleaning").id, assigneeId: crew2 });
    expect(s.notified()).toEqual([]);
  });
});

describe("booking (Scheduled)", () => {
  it("lets a manager book a later step ahead, like Balwin's photos", () => {
    const s = new Scenario();
    s.run(admin, { type: "schedule", stepId: s.step("photos").id, on: "2026-11-14", time: "10:00" });
    expect(s.step("photos")).toMatchObject({ status: "scheduled", scheduledOn: "2026-11-14", scheduledTime: "10:00" });
    expect(isStepUpcomingBooking(s.t.steps, 4)).toBe(true);
    expect(s.notified()).toEqual([
      { to: photographer, kind: "booking_created", data: expect.objectContaining({ on: "2026-11-14", time: "10:00" }) },
    ]);
    expect(stageOf(s).currentStage).toBe("1. Inspection");
    // The photographer can see the booking but can't act on it yet.
    expectRule(() => s.run(photographer, { type: "start", stepId: s.step("photos").id }), "FORBIDDEN");
  });

  it("tells the booked person when the unit is ready for them", () => {
    const s = new Scenario();
    s.run(admin, { type: "schedule", stepId: s.step("cleaning").id, on: "2026-11-08" });
    atWork(s);
    s.finish("work");
    expect(s.notified()).toEqual([
      { to: cleaner, kind: "step_ready_booked", data: expect.objectContaining({ scheduledOn: "2026-11-08" }) },
    ]);
    expect(s.step("cleaning").status).toBe("scheduled");
  });

  it("lets assignees book their own active step, with a valid date and time", () => {
    const s = new Scenario();
    const id = s.step("inspection").id;
    expectRule(() => s.run(inspector, { type: "schedule", stepId: id, on: "2026-13-01" }), "VALIDATION");
    expectRule(() => s.run(inspector, { type: "schedule", stepId: id, on: "2026-11-04", time: "9am" }), "VALIDATION");
    s.run(inspector, { type: "schedule", stepId: id, on: "2026-11-04", time: "09:30" });
    expect(s.notified()).toEqual([]); // nobody to tell: they booked it themselves
    s.run(inspector, { type: "start", stepId: id });
    expectRule(() => s.run(inspector, { type: "schedule", stepId: id, on: "2026-11-05" }), "INVALID_STATE", /already started/);
  });

  it("cancelling a booking puts the step back to Not started", () => {
    const s = new Scenario();
    s.run(admin, { type: "schedule", stepId: s.step("photos").id, on: "2026-11-14" });
    s.run(admin, { type: "unschedule", stepId: s.step("photos").id });
    expect(s.step("photos")).toMatchObject({ status: "not_started", scheduledOn: null });
    expect(s.notified()).toEqual([{ to: photographer, kind: "booking_cancelled", data: expect.objectContaining({ on: "2026-11-14" }) }]);
  });
});

describe("overdue and due dates", () => {
  it("flags the turnover Due soon, then Overdue, as the target date passes", () => {
    const s = new Scenario({ moveOutDate: START_DAY, targetReadyDate: "2026-11-12" });
    s.clock.advance(6); // Nov 8: 4 days to go
    expect(stageOf(s).flag).toBe("On track");
    s.clock.advance(1); // Nov 9: 3 days to go
    expect(stageOf(s).flag).toBe("Due soon");
    s.clock.advance(4); // Nov 13
    expect(stageOf(s).flag).toBe("Overdue");
  });

  it("gives each step a due date when it becomes active", () => {
    const s = new Scenario();
    s.clock.advance(2);
    atWork(s); // work activated on Nov 4, due 5 days later
    expect(s.step("work").dueOn).toBe("2026-11-09");
  });
});

describe("notes and turnover details", () => {
  it("records notes on the timeline, only from the assignee or a manager", () => {
    const s = new Scenario();
    s.run(inspector, { type: "addNote", stepId: s.step("inspection").id, text: "Key is in lockbox 4" });
    expect(s.last.events[0]).toMatchObject({ type: "note_added", data: { text: "Key is in lockbox 4" } });
    expectRule(() => s.run(cleaner, { type: "addNote", stepId: s.step("inspection").id, text: "hi" }), "FORBIDDEN");
  });

  it("lets a manager change dates, recording what changed", () => {
    const s = new Scenario({ moveOutDate: START_DAY });
    s.run(admin, { type: "updateTurnover", targetReadyDate: "2026-11-20", notes: "Owner wants it by the 20th" });
    expect(s.t.targetReadyDate).toBe("2026-11-20");
    expect(s.last.events[0].data).toEqual({
      changes: {
        targetReadyDate: { from: "2026-11-12", to: "2026-11-20" },
        notes: { from: null, to: "Owner wants it by the 20th" },
      },
    });
    expectRule(() => s.run(admin, { type: "updateTurnover", moveOutDate: "Nov 2" }), "VALIDATION");
  });
});

describe("version", () => {
  let s: Scenario;
  beforeEach(() => {
    s = new Scenario();
  });
  it("goes up by one with every change, for spotting conflicting edits", () => {
    expect(s.t.version).toBe(1);
    s.run(inspector, { type: "start", stepId: s.step("inspection").id });
    expect(s.t.version).toBe(2);
  });
});

describe("inspection findings draft the scope", () => {
  const findings = [
    { id: "f1", room: "Kitchen", description: "Cracked floor tile by the fridge", needsWork: true },
    { id: "f2", room: "Bathroom 1", description: "Grout stained, cleaning should do it", needsWork: false },
    { id: "f3", room: "Whole unit", description: "Touch up paint", needsWork: true },
  ];

  it("turns findings that need work into scope items for the manager to review", () => {
    const s = new Scenario();
    s.run(inspector, { type: "complete", stepId: s.step("inspection").id, findings });
    expect(s.step("scope").checklist.map((c) => [c.text, c.state, c.source, c.sourceItemId])).toEqual([
      ["Kitchen: Cracked floor tile by the fridge", "open", "inspection", "f1"],
      ["Touch up paint", "open", "inspection", "f3"],
    ]);
    expect(s.notified()).toEqual([{ to: admin, kind: "step_assigned", data: expect.objectContaining({ stepName: "Scope of work" }) }]);
  });

  it("doesn't copy a finding twice when the inspection is redone after a send-back", () => {
    const s = new Scenario();
    s.run(inspector, { type: "complete", stepId: s.step("inspection").id, findings });
    s.run(admin, { type: "sendBack", fromStepId: s.step("scope").id, toStepId: s.step("inspection").id, reason: "Check the balcony too" });
    s.run(inspector, {
      type: "complete",
      stepId: s.step("inspection").id,
      findings: [...findings, { id: "f4", room: "Balcony / patio", description: "Loose railing", needsWork: true }],
    });
    expect(s.step("scope").checklist.map((c) => c.sourceItemId)).toEqual(["f1", "f3", "f4"]);
  });

  it("leaves the scope empty when nothing needs work, so approving it skips in-house work", () => {
    const s = new Scenario();
    s.run(inspector, { type: "complete", stepId: s.step("inspection").id, findings: [findings[1]] });
    expect(s.step("scope").checklist).toEqual([]);
    s.finish("scope");
    expect(s.step("work").status).toBe("na");
  });
});
