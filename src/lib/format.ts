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
