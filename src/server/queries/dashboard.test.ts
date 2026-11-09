import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DbHandle, migrateDatabase, openPglite } from "@/db/client";
import { seedDemo } from "@/db/seed/demo";
import { DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import { buildDashboard, parseFilters } from "./dashboard";
import { listTurnovers, type TurnoverList } from "./turnovers";

let handle: DbHandle;
let list: TurnoverList;
let people: Map<string, string>;
beforeAll(async () => {
  handle = await openPglite(null);
  await migrateDatabase(handle);
  const demo = await seedDemo(handle.db, { today: "2026-11-09" });
  people = demo.peopleIds;
  list = await listTurnovers(handle.db, { today: "2026-11-09" });
}, 120_000);
afterAll(async () => {
  await handle.close();
});

const board = (params: Record<string, string> = {}) => buildDashboard(list, DEFAULT_TEMPLATE_STEPS, parseFilters(params));
const units = (d: ReturnType<typeof board>) => d.cards.map((c) => `${c.propertyName} ${c.unit}`);

describe("dashboard", () => {
  it("shows every unit that isn't complete, most urgent first", () => {
    const d = board();
    expect(d.cards).toHaveLength(19);
    expect(units(d).slice(0, 3)).toEqual(["WR 315", "Parkdale 405", "Oakwood 101"]);
    expect(d.cards.map((c) => c.flag)).not.toContain("Complete");
  });

  it("has the six stages as board columns, in workflow order", () => {
    expect(board().columns.map((c) => c.label)).toEqual([
      "1. Inspection",
      "2. Scope of work",
      "3. In-house work",
      "4. Cleaning",
      "5. Photos",
      "6. Leasing upload",
    ]);
  });

  it("filters by flag, stage, property, assignee and search text", () => {
    expect(units(board({ flag: "Overdue" }))).toEqual(["WR 315", "Parkdale 405"]);
    expect(units(board({ stage: "inspection" })).sort()).toEqual(["Rivergate 303", "Rivergate 305"]);
    const balwin = list.rows.find((r) => r.propertyName === "Balwin")!.turnover.propertyId;
    expect(board({ property: balwin }).cards).toHaveLength(6);
    expect(units(board({ assignee: people.get("crewC")! })).sort()).toEqual(["WR 315"]);
    expect(units(board({ q: "grand 10" })).sort()).toEqual(["Grandview 102", "Grandview 105"]);
    expect(units(board({ missing: "moveout" }))).toEqual(["Rivergate 305"]);
  });

  it("shows completed units only when asked", () => {
    const finished = units(board({ complete: "1", stage: "complete" }));
    // Courts 26, and the demo's history of finished turns.
    expect(finished).toContain("Courts 26");
    expect(finished).toHaveLength(25);
    expect(units(board({ flag: "Complete" }))).toEqual(finished);
    expect(board().cards.some((c) => c.flag === "Complete")).toBe(false);
  });

  it("puts each card in its current stage's column, with who has it now", () => {
    const acadian = board().cards.find((c) => c.propertyName === "Acadian")!;
    expect(acadian).toMatchObject({ columnKey: "work", currentStage: "3. In-house work", flag: "Due soon" });
    expect(acadian.activeSteps).toEqual([expect.objectContaining({ name: "In-house work", assigneeName: "Crew A" })]);
  });

  it("shows blockers, bookings made ahead, and send-backs on cards", () => {
    const cards = board().cards;
    expect(cards.find((c) => c.unit === "101")!.blockers[0].reason).toMatch(/fridge/);
    expect(cards.find((c) => c.propertyName === "Balwin")!.upcomingBookings).toEqual([{ stepName: "Photos", on: "2026-11-14" }]);
    expect(cards.find((c) => c.unit === "310")!.reworkCount).toBe(1);
  });

  it("computes the Summary tab from every unit, not just the filtered ones", () => {
    const d = board({ flag: "Overdue" });
    expect(d.summary).toMatchObject({ activeTurns: 19, overdue: 2, blocked: 1, completedAllTime: 25, missingMoveOut: 1 });
  });

  it("ignores filter values it doesn't recognise", () => {
    expect(parseFilters({ flag: "Whatever", q: "  " })).toMatchObject({ flag: undefined, q: undefined });
  });
});

describe("bookings whose day has passed", () => {
  it("are marked so a manager can check whether the visit happened", () => {
    const balwin = board().cards.find((c) => c.propertyName === "Balwin")!;
    expect(balwin.activeSteps[0]).toMatchObject({ name: "Cleaning", status: "scheduled", scheduledOn: "2026-11-08", bookingPassed: true });
    const parkdale = board().cards.find((c) => c.propertyName === "Parkdale")!;
    expect(parkdale.activeSteps[0]).toMatchObject({ name: "Photos", bookingPassed: false });
  });
});
