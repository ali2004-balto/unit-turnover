import { describe, expect, it } from "vitest";
import {
  addDays,
  dateInZone,
  daysBetween,
  formatShort,
  fromSheetSerial,
  isDateOnly,
  latestDate,
  weekday,
} from "./dates";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isDateOnly("2026-11-09")).toBe(true);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-11-9")).toBe(false);
    expect(isDateOnly("2026-11-09T00:00:00Z")).toBe(false);
  });

  it("does day arithmetic across month and DST boundaries", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(daysBetween("2026-11-09", "2026-10-30")).toBe(10);
    expect(daysBetween("2027-03-15", "2027-03-01")).toBe(14); // spans the March DST change
  });

  it("finds the latest date and ignores blanks", () => {
    expect(latestDate([null, "2026-11-05", undefined, "2026-11-06", "2026-10-31"])).toBe("2026-11-06");
    expect(latestDate([null, null])).toBeNull();
  });

  it("reads Google Sheets date serials", () => {
    expect(fromSheetSerial(46332)).toBe("2026-11-06"); // Acadian 203's inspection date
    expect(fromSheetSerial(46331.75)).toBe("2026-11-05");
  });

  it("works out today's date in a given time zone", () => {
    const instant = new Date("2026-11-10T06:30:00Z"); // 10:30 pm Nov 9 in Pacific time
    expect(dateInZone(instant, "America/Vancouver")).toBe("2026-11-09");
    expect(dateInZone(instant, "America/Toronto")).toBe("2026-11-10");
  });

  it("formats bookings the way the sheet's notes write them", () => {
    expect(weekday("2026-11-08")).toBe(0);
    expect(formatShort("2026-11-08")).toBe("Sun Nov 8");
    expect(formatShort("2026-11-14")).toBe("Sat Nov 14");
  });
});
