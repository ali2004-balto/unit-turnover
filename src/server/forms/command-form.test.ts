import { describe, expect, it } from "vitest";
import { commandFromForm } from "./command-form";

const T = "8b7f6d33-6c55-4f3e-9d4a-0f2a1c3b4d5e";
const S = "1e2d3c4b-5a69-4788-9a1b-2c3d4e5f6a7b";
const S2 = "2e2d3c4b-5a69-4788-9a1b-2c3d4e5f6a7b";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ turnoverId: T, ...fields })) fd.set(k, v);
  return fd;
}

describe("commandFromForm", () => {
  it("reads a block with its reason and the version the screen showed", () => {
    expect(commandFromForm(form({ type: "block", stepId: S, reason: "  Waiting on parts ", version: "4", requestId: "abcdefgh-1" }))).toEqual({
      ok: true,
      turnoverId: T,
      version: 4,
      requestId: "abcdefgh-1",
      command: { type: "block", stepId: S, reason: "Waiting on parts" },
    });
  });

  it("reads a booking, with or without a time", () => {
    const r = commandFromForm(form({ type: "schedule", stepId: S, on: "2026-11-14", time: "" }));
    expect(r).toMatchObject({ ok: true, command: { type: "schedule", on: "2026-11-14", time: null } });
    expect(commandFromForm(form({ type: "schedule", stepId: S, on: "Nov 14" }))).toEqual({ ok: false, error: "Pick a real date." });
  });

  it("reads a send-back's checkbox", () => {
    const on = commandFromForm(form({ type: "sendBack", fromStepId: S, toStepId: S2, reason: "Scuff", reopenBetween: "on" }));
    const off = commandFromForm(form({ type: "sendBack", fromStepId: S, toStepId: S2, reason: "Scuff" }));
    expect(on).toMatchObject({ command: { reopenBetween: true } });
    expect(off).toMatchObject({ command: { reopenBetween: false } });
  });

  it("treats an empty choice as 'nobody' when reassigning", () => {
    expect(commandFromForm(form({ type: "reassign", stepId: S, assigneeId: "" }))).toMatchObject({ command: { assigneeId: null } });
    expect(commandFromForm(form({ type: "reassign", stepId: S, assigneeId: "x" }))).toEqual({ ok: false, error: "Pick someone from the list." });
  });

  it("clears dates left blank when editing a turnover", () => {
    expect(commandFromForm(form({ type: "updateTurnover", moveOutDate: "2026-11-02", targetReadyDate: "", notes: "Keys at office" }))).toMatchObject({
      command: { type: "updateTurnover", moveOutDate: "2026-11-02", targetReadyDate: null, notes: "Keys at office" },
    });
  });

  it("refuses unknown commands, bad ids and overlong text", () => {
    expect(commandFromForm(form({ type: "deleteEverything" }))).toMatchObject({ ok: false });
    expect(commandFromForm(form({ type: "start", stepId: "not-an-id" }))).toMatchObject({ ok: false });
    expect(commandFromForm(form({ type: "block", stepId: S, reason: "x".repeat(501) }))).toEqual({
      ok: false,
      error: "Please keep it under 500 characters.",
    });
  });
});
