import { describe, expect, it } from "vitest";
import { fit, firstName, needsYou, overnightStart, zonedInstant } from "./tv-board";

// Toronto: UTC-5 in November, and its clocks change on Nov 1, 2026.
const TZ = "America/Toronto";

describe("the 6 pm window for Done overnight", () => {
  it("starts at 6 pm yesterday, local time, when read in the morning or just after midnight", () => {
    // Thu Nov 12, 7:00 a.m. local, and 12:30 a.m. local: since Nov 11, 6 pm (23:00 UTC).
    expect(overnightStart(new Date("2026-11-12T12:00:00Z"), TZ).toISOString()).toBe("2026-11-11T23:00:00.000Z");
    expect(overnightStart(new Date("2026-11-12T05:30:00Z"), TZ).toISOString()).toBe("2026-11-11T23:00:00.000Z");
  });

  it("just before midnight it is still yesterday's 6 pm that counts", () => {
    // Wed Nov 11, 11:30 p.m. local: yesterday is Nov 10.
    expect(overnightStart(new Date("2026-11-12T04:30:00Z"), TZ).toISOString()).toBe("2026-11-10T23:00:00.000Z");
  });

  it("puts events on the right side of 6 pm and of midnight", () => {
    const start = overnightStart(new Date("2026-11-12T12:00:00Z"), TZ).getTime();
    const inWindow = (iso: string) => new Date(iso).getTime() >= start;
    expect(inWindow("2026-11-11T22:59:00Z")).toBe(false); // 5:59 p.m. Nov 11
    expect(inWindow("2026-11-11T23:00:00Z")).toBe(true); // 6:00 p.m. Nov 11
    expect(inWindow("2026-11-12T04:30:00Z")).toBe(true); // 11:30 p.m. Nov 11, before midnight
    expect(inWindow("2026-11-12T05:30:00Z")).toBe(true); // 12:30 a.m. Nov 12, after midnight
  });

  it("follows the clock change", () => {
    expect(zonedInstant("2026-10-31", "18:00", TZ).toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(zonedInstant("2026-11-01", "18:00", TZ).toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("Needs you", () => {
  const card = (id: string, flag: string, steps: Array<[string, string | null]> = []) => ({
    id,
    propertyName: "Acadian",
    unit: id,
    flag,
    activeSteps: steps.map(([name, assigneeId]) => ({ name, assigneeId })),
  });
  const cards = [
    card("101", "Overdue", [["Cleaning", "sam"]]),
    card("102", "Blocked", [["Photos", "me"]]),
    card("103", "Due soon", [["Scope of work", "me"]]),
    card("104", "On track", [["Inspection", "me"], ["Work", "me"]]),
    card("105", "On track", [["Inspection", "sam"]]),
    card("106", "Due soon", [["Inspection", "sam"]]),
  ];

  it("lists steps that are the owner's turn plus every blocked or overdue turn, in the given order", () => {
    const items = needsYou(cards, "me");
    expect(items.map((i) => i.id)).toEqual(["101", "102", "103", "104"]);
    expect(items.find((i) => i.id === "101")!.yourSteps).toEqual([]);
    expect(items.find((i) => i.id === "102")!.yourSteps).toEqual(["Photos"]);
    expect(items.find((i) => i.id === "104")!.yourSteps).toEqual(["Inspection", "Work"]);
  });

  it("leaves out other people's steps on turns that are on track or only due soon", () => {
    expect(needsYou(cards, "me").map((i) => i.id)).not.toContain("105");
    expect(needsYou(cards, "me").map((i) => i.id)).not.toContain("106");
  });

  it("with no owner, still shows blocked and overdue turns", () => {
    expect(needsYou(cards, null).map((i) => i.id)).toEqual(["101", "102"]);
  });
});

describe("small helpers", () => {
  it("keeps first names only", () => {
    expect(firstName("Ali Farhat")).toBe("Ali");
    expect(firstName("  Crew   A ")).toBe("Crew");
    expect(firstName(null)).toBeNull();
    expect(firstName("")).toBeNull();
  });

  it("counts what didn't fit", () => {
    expect(fit([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(fit([1], 3)).toEqual({ shown: [1], more: 0 });
  });
});
