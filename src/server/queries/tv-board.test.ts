import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db/client";
import { seedDemo } from "@/db/seed/demo";
import { createEmptyDb } from "@/test/db";
import { loadTvBoard, newTvLink, removeTvLink, tvLinkOwner } from "./tv-board";

const TODAY = "2026-11-09";
let handle: DbHandle;
let ids: Map<string, string>;

beforeAll(async () => {
  handle = await createEmptyDb();
  ids = (await seedDemo(handle.db, { today: TODAY })).peopleIds;
}, 120_000);
afterAll(async () => {
  await handle.close();
});

describe("the TV link", () => {
  it("accepts the right token and says whose it is", async () => {
    const token = await newTvLink(handle.db, ids.get("manager")!);
    expect(await tvLinkOwner(handle.db, token)).toEqual({ ownerId: ids.get("manager") });
  });

  it("refuses a wrong or empty token", async () => {
    const token = await newTvLink(handle.db, ids.get("manager")!);
    expect(await tvLinkOwner(handle.db, `${token}x`)).toBeNull();
    expect(await tvLinkOwner(handle.db, token.slice(1))).toBeNull();
    expect(await tvLinkOwner(handle.db, "")).toBeNull();
  });

  it("stops working when it is replaced", async () => {
    const first = await newTvLink(handle.db, ids.get("manager")!);
    const second = await newTvLink(handle.db, ids.get("manager")!);
    expect(second).not.toBe(first);
    expect(await tvLinkOwner(handle.db, first)).toBeNull();
    expect(await tvLinkOwner(handle.db, second)).not.toBeNull();
  });

  it("stops working when it is turned off", async () => {
    const token = await newTvLink(handle.db, ids.get("manager")!);
    await removeTvLink(handle.db);
    expect(await tvLinkOwner(handle.db, token)).toBeNull();
    expect(await tvLinkOwner(handle.db, "")).toBeNull();
  });
});

describe("the board's data", () => {
  it("has every panel's numbers from the demo data, and nothing private", async () => {
    const now = new Date("2026-11-09T16:00:00Z");
    const board = await loadTvBoard(handle.db, ids.get("crewB")!, now);
    expect(board.today).toBe(TODAY);
    expect(board.stages.length).toBeGreaterThan(0);
    expect(board.turns.length).toBe(board.metrics.active);
    expect(board.metrics.needYou).toBe(board.needs.length);
    // Worst first: no on-track turn sits above an overdue one.
    const order = board.turns.map((t) => t.flag);
    expect(order.lastIndexOf("Overdue")).toBeLessThan(order.indexOf("On track") === -1 ? Infinity : order.indexOf("On track"));
    // Crew B's own steps show, and every blocked or overdue turn does too.
    expect(board.needs.some((n) => n.yourSteps.length > 0)).toBe(true);
    const late = board.turns.filter((t) => t.flag === "Overdue" || t.flag === "Blocked").map((t) => t.id);
    for (const id of late) expect(board.needs.map((n) => n.id)).toContain(id);

    const text = JSON.stringify(board);
    expect(text).not.toMatch(/@|\+1604|604555/);
    expect(text).not.toContain("Crew B");
  });
});
