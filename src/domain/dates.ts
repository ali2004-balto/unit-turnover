/**
 * Calendar dates with no time or time zone, written "YYYY-MM-DD".
 *
 * This is exactly what a date cell in the Google Sheet holds, and every day
 * count in the app (days vacant, days in stage, due soon, overdue) works on
 * these, never on raw timestamps.
 */
export type DateOnly = string;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
/** Google Sheets counts days from 1899-12-30, so 1970-01-01 is day 25569. */
const SHEETS_EPOCH_OFFSET = 25_569;

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== "string") return false;
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function assertDateOnly(value: string, label = "date"): DateOnly {
  if (!isDateOnly(value)) throw new Error(`${label} must be a real date written YYYY-MM-DD (got "${value}")`);
  return value;
}

/** Whole days since 1970-01-01. */
export function toDayNumber(date: DateOnly): number {
  const m = DATE_ONLY.exec(date);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: "${date}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

export function fromDayNumber(day: number): DateOnly {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  return fromDayNumber(toDayNumber(date) + days);
}

/** `a − b` in whole days, the same as subtracting two date cells in the sheet. */
export function daysBetween(a: DateOnly, b: DateOnly): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** The latest of the given dates, ignoring blanks (the sheet's MAX over date cells). */
export function latestDate(dates: Iterable<DateOnly | null | undefined>): DateOnly | null {
  let latest: DateOnly | null = null;
  for (const d of dates) {
    // YYYY-MM-DD strings sort the same way the dates do.
    if (d && (latest === null || d > latest)) latest = d;
  }
  return latest;
}

/** The calendar date an instant falls on in a time zone (e.g. "today" in Pacific time). */
export function dateInZone(instant: Date, timeZone: string): DateOnly {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Google Sheets date serial number (e.g. 46332) to a date (2026-11-06). */
export function fromSheetSerial(serial: number): DateOnly {
  return fromDayNumber(Math.floor(serial) - SHEETS_EPOCH_OFFSET);
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: DateOnly): number {
  // 1970-01-01 was a Thursday (4).
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

/** "Sun Nov 8", the way bookings are written in the sheet's notes. */
export function formatShort(date: DateOnly): string {
  const [, mo, d] = date.split("-").map(Number);
  return `${WEEKDAYS_SHORT[weekday(date)]} ${MONTHS_SHORT[mo - 1]} ${d}`;
}

export { MONTHS_SHORT, WEEKDAYS_SHORT };
