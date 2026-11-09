import { describe, expect, it } from "vitest";
import { derive, type DerivedInput, isPastTarget } from "./derived";
import type { DateOnly } from "./dates";
import { statusFromSheet, type StepStatus } from "./status";

const STEP_NAMES = ["Inspection", "Scope of work", "In-house work", "Cleaning", "Photos", "Leasing upload"];
const TODAY: DateOnly = "2026-11-09";

/** Build a row the way it looks in the sheet: six status cells and six date cells. */
function row(opts: {
  moveOut?: DateOnly | null;
  target?: DateOnly | null;
  statuses?: Array<string>;
  dates?: Array<DateOnly | null>;
}): DerivedInput {
  const statuses = opts.statuses ?? Array(6).fill("Not started");
  return {
    moveOutDate: opts.moveOut ?? null,
    targetReadyDate: opts.target ?? null,
    steps: STEP_NAMES.map((name, i) => ({ name, status: statusFromSheet(statuses[i] ?? "") as StepStatus | null })),
    stepDates: opts.dates ?? Array(6).fill(null),
  };
}

const ALL_DONE = Array(6).fill("Done");

describe("Current stage (column E)", () => {
  it.each([
    [["Not started", "Not started", "Not started", "Not started", "Not started", "Not started"], "1. Inspection"],
    [["In progress", "Not started", "Not started", "Not started", "Not started", "Not started"], "1. Inspection"],
    [["Done", "Not started", "Not started", "Not started", "Not started", "Not started"], "2. Scope of work"],
    [["Done", "Done", "Not started", "Not started", "Not started", "Not started"], "3. In-house work"],
    [["Done", "Done", "N/A", "Scheduled", "Scheduled", "Not started"], "4. Cleaning"],
    [["Done", "Done", "Done", "Done", "Scheduled", "Not started"], "5. Photos"],
    [["Done", "Done", "Done", "Done", "Done", "Blocked"], "6. Leasing upload"],
    [["Done", "N/A", "N/A", "Done", "Done", "Done"], "Complete"],
    [ALL_DONE, "Complete"],
  ])("%j → %s", (statuses, expected) => {
    expect(derive(row({ statuses }), TODAY, 3).currentStage).toBe(expected);
  });

  it("treats a blank status as not finished, like the sheet", () => {
    expect(derive(row({ statuses: ["Done", "", "Done", "Done", "Done", "Done"] }), TODAY, 3).currentStage).toBe(
      "2. Scope of work",
    );
  });

  it("stops at the first unfinished step even when later steps are already Done", () => {
    const d = derive(row({ statuses: ["Done", "Done", "In progress", "Done", "Done", "Done"] }), TODAY, 3);
    expect(d.currentStage).toBe("3. In-house work");
    expect(d.currentStepIndex).toBe(2);
    expect(d.isComplete).toBe(false);
  });
});

describe("Days vacant (column F)", () => {
  it("is blank without a move-out date", () => {
    expect(derive(row({ moveOut: null }), TODAY, 3).daysVacant).toBeNull();
    expect(derive(row({ moveOut: null, statuses: ALL_DONE, dates: ["2026-11-01", null, null, null, null, null] }), TODAY, 3).daysVacant).toBeNull();
  });

  it("counts move-out to today while active", () => {
    expect(derive(row({ moveOut: "2026-10-30" }), TODAY, 3).daysVacant).toBe(10);
    expect(derive(row({ moveOut: TODAY }), TODAY, 3).daysVacant).toBe(0);
  });

  it("never goes negative for a future move-out (MAX(0, …))", () => {
    expect(derive(row({ moveOut: "2026-11-20" }), TODAY, 3).daysVacant).toBe(0);
  });

  it("stops counting once complete: latest step date minus move-out", () => {
    const d = derive(
      row({
        moveOut: "2026-10-01",
        statuses: ALL_DONE,
        dates: ["2026-10-02", "2026-10-03", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-11"],
      }),
      TODAY,
      3,
    );
    expect(d.daysVacant).toBe(11); // Oct 12 − Oct 1, not today − Oct 1
  });

  it("is blank when complete with no step dates (MAX(…)=0)", () => {
    expect(derive(row({ moveOut: "2026-10-01", statuses: ALL_DONE }), TODAY, 3).daysVacant).toBeNull();
  });

  it("is not clamped at zero when complete (the sheet has no MAX(0, …) there)", () => {
    const d = derive(
      row({ moveOut: "2026-10-10", statuses: ALL_DONE, dates: ["2026-10-08", null, null, null, null, null] }),
      TODAY,
      3,
    );
    expect(d.daysVacant).toBe(-2);
  });
});

describe("Days in stage (column G)", () => {
  it("is blank without a move-out date or once complete", () => {
    expect(derive(row({ moveOut: null, dates: ["2026-11-01", null, null, null, null, null] }), TODAY, 3).daysInStage).toBeNull();
    expect(derive(row({ moveOut: "2026-10-01", statuses: ALL_DONE, dates: ["2026-10-02", null, null, null, null, null] }), TODAY, 3).daysInStage).toBeNull();
  });

  it("counts from move-out when no step has a date", () => {
    expect(derive(row({ moveOut: "2026-11-02" }), TODAY, 3).daysInStage).toBe(7);
  });

  it("counts from the most recent date anywhere on the row", () => {
    const d = derive(
      row({
        moveOut: "2026-10-20",
        statuses: ["Done", "Done", "In progress", "Not started", "Not started", "Not started"],
        dates: ["2026-10-22", "2026-11-04", null, null, null, null],
      }),
      TODAY,
      3,
    );
    expect(d.daysInStage).toBe(5); // since Nov 4
  });

  it("uses the latest date even if an earlier step's date is later than a later step's", () => {
    const d = derive(
      row({ moveOut: "2026-10-20", statuses: ["Done", "Done"], dates: ["2026-11-06", "2026-11-01", null, null, null, null] }),
      TODAY,
      3,
    );
    expect(d.daysInStage).toBe(3);
  });

  it("never goes negative when a date is in the future", () => {
    const d = derive(row({ moveOut: "2026-10-20", dates: [null, null, null, null, "2026-11-14", null] }), TODAY, 3);
    expect(d.daysInStage).toBe(0);
  });
});

describe("Flag (column H), in priority order", () => {
  it("Complete beats everything, even a past target", () => {
    expect(derive(row({ statuses: ALL_DONE, target: "2026-10-01" }), TODAY, 3).flag).toBe("Complete");
  });

  it("Blocked beats Overdue and No target date", () => {
    const blocked = ["Done", "Done", "Blocked", "Not started", "Not started", "Not started"];
    expect(derive(row({ statuses: blocked, target: "2026-11-01" }), TODAY, 3).flag).toBe("Blocked");
    expect(derive(row({ statuses: blocked, target: null }), TODAY, 3).flag).toBe("Blocked");
  });

  it("is Blocked when any step is Blocked, even one after the current stage", () => {
    const statuses = ["Done", "In progress", "Not started", "Not started", "Blocked", "Not started"];
    expect(derive(row({ statuses, target: "2026-12-31" }), TODAY, 3).flag).toBe("Blocked");
  });

  it("No target date when the target is blank", () => {
    expect(derive(row({ target: null }), TODAY, 3).flag).toBe("No target date");
  });

  it("Overdue only after the target day", () => {
    expect(derive(row({ target: "2026-11-08" }), TODAY, 3).flag).toBe("Overdue");
    expect(derive(row({ target: TODAY }), TODAY, 3).flag).toBe("Due soon");
  });

  it("Due soon within the window, including its last day", () => {
    expect(derive(row({ target: "2026-11-12" }), TODAY, 3).flag).toBe("Due soon"); // 3 days away
    expect(derive(row({ target: "2026-11-13" }), TODAY, 3).flag).toBe("On track"); // 4 days away
  });

  it("follows the due-soon window setting", () => {
    expect(derive(row({ target: "2026-11-16" }), TODAY, 7).flag).toBe("Due soon");
    expect(derive(row({ target: "2026-11-10" }), TODAY, 0).flag).toBe("On track");
    expect(derive(row({ target: TODAY }), TODAY, 0).flag).toBe("Due soon");
  });

  it("does not depend on the move-out date", () => {
    expect(derive(row({ moveOut: null, target: "2026-11-30" }), TODAY, 3).flag).toBe("On track");
  });
});

describe("isPastTarget", () => {
  it("still reports a blocked unit as past its target, which the flag hides", () => {
    const input = row({ statuses: ["Blocked"], target: "2026-11-01" });
    const d = derive(input, TODAY, 3);
    expect(d.flag).toBe("Blocked");
    expect(isPastTarget(input, d.isComplete, TODAY)).toBe(true);
  });
});
