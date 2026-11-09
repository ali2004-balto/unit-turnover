import { describe, expect, it } from "vitest";
import { describeEvents, type TimelineEvent } from "./describe";

const names: Record<string, string> = { a: "Manager", c: "Crew A", p: "Photographer A" };
const nameOf = (id: string | null) => (id ? (names[id] ?? null) : null);
let n = 0;
const ev = (type: string, fields: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: ++n,
  type,
  stepName: null,
  actorId: null,
  data: {},
  at: new Date(Date.parse("2026-11-09T17:00:00Z") + n * 60_000),
  ...fields,
});

describe("describeEvents", () => {
  it("writes each change in plain English, newest first", () => {
    const entries = describeEvents(
      [
        ev("turnover_created", { actorId: "a" }),
        ev("step_scheduled", { actorId: "a", stepName: "Photos", data: { on: "2026-11-14", time: "10:00", ahead: true } }),
        ev("step_blocked", { actorId: "c", stepName: "In-house work", data: { reason: "Waiting on the fridge" } }),
        ev("sent_back", { actorId: "p", stepName: "Photos", data: { toStepName: "In-house work", reason: "Scuff on wall" } }),
      ],
      nameOf,
    );
    expect(entries.map((e) => [e.text, e.detail, e.tone])).toEqual([
      ["Photographer A sent the unit back from Photos to In-house work", "Scuff on wall", "warning"],
      ["Crew A blocked In-house work", "Waiting on the fridge", "danger"],
      ["Manager booked Photos for Sat Nov 14 at 10:00, ahead of time", undefined, "default"],
      ["Manager created the turnover", undefined, "default"],
    ]);
  });

  it("collapses a run of ticked items by the same person into one line", () => {
    const entries = describeEvents(
      [
        ev("checklist_item_updated", { actorId: "c", stepName: "In-house work", data: { text: "Junk removal", to: "done" } }),
        ev("checklist_item_updated", { actorId: "c", stepName: "In-house work", data: { text: "Touch up paint", to: "done" } }),
        ev("step_completed", { actorId: "c", stepName: "In-house work" }),
      ],
      nameOf,
    );
    expect(entries.map((e) => [e.text, e.detail])).toEqual([
      ["Crew A marked In-house work Done", undefined],
      ["Crew A ticked off 2 items on In-house work", "Junk removal · Touch up paint"],
    ]);
  });

  it("credits the system for automatic changes and shows date edits", () => {
    const entries = describeEvents(
      [
        ev("step_skipped", { stepName: "In-house work", data: { automatic: true, reason: "No work needed: the approved scope is empty" } }),
        ev("turnover_updated", { actorId: "a", data: { changes: { targetReadyDate: { from: "2026-11-12", to: "2026-11-20" } } } }),
      ],
      nameOf,
    );
    expect(entries.map((e) => [e.text, e.detail])).toEqual([
      ["Manager changed the target ready date", "target ready date: Thu Nov 12 → Fri Nov 20"],
      ["In-house work skipped (N/A)", "No work needed: the approved scope is empty"],
    ]);
  });
});
