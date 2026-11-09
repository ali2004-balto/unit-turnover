import { type DateOnly, formatShort } from "@/domain/dates";

/** Blank stays blank, like an empty cell in the sheet. */
export function formatDays(days: number | null): string {
  return days === null ? "" : String(days);
}

/** Averages show "-" when there is nothing to average, like the Summary tab. */
export function formatAverage(value: number | null): string {
  if (value === null) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatDate(date: DateOnly | null): string {
  return date ?? "";
}

export function formatBooking(on: DateOnly | null, time: string | null): string {
  if (!on) return "";
  return time ? `${formatShort(on)}, ${time}` : formatShort(on);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 14" */
export function formatMonthDay(date: DateOnly | null): string {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Nov 14, 2026, 9:05 a.m." in the business time zone. */
export function formatDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
