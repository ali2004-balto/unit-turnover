/**
 * CSV files for spreadsheets (Excel, Google Sheets, Numbers).
 *
 * Text that starts like a formula (= + - @) gets a leading apostrophe, so a
 * note someone typed can never run as a formula when the file is opened.
 * Numbers are written as numbers.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file, with the marker Excel needs to read accents correctly. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Undoes the apostrophe added above, when a CSV made by the app is read back in. */
export function unguardCell(text: string): string {
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}
