/**
 * Reads a pasted list of units for bulk-adding turnovers. Each line is one
 * unit (or a range of units), in whatever shape is easiest to paste:
 *
 *   Acadian 203
 *   Balwin 1-6, 2026-11-15
 *   Parkdale, 405, Nov 2, Nov 12          (property, unit, move-out, target)
 *   Grandview<TAB>105<TAB>2026-11-02      (copied from a spreadsheet)
 *
 * Pure, so the screen can show a preview and the server can re-check the
 * same rules before creating anything.
 */
import { type DateOnly, daysBetween, isDateOnly } from "./dates";

export interface BulkProperty {
  id: string;
  name: string;
}

export interface BulkRow {
  line: number;
  text: string;
  propertyId?: string;
  propertyName?: string;
  unit?: string;
  moveOutDate: DateOnly | null;
  /** undefined: use move-out + the default target days. */
  targetReadyDate?: DateOnly;
  error?: string;
  warning?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MAX_RANGE = 50;

/** Dates people type: 2026-11-15, 2026/11/15, Nov 15, Nov 15 2026, 15 Nov, November 15, 2026. */
export function parseLooseDate(text: string, today: DateOnly): DateOnly | null {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return isDateOnly(d) ? d : null;
  }
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  m = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(t);
  if (m) [month, day, year] = [MONTHS.indexOf(m[1].slice(0, 3)), Number(m[2]), m[3] ? Number(m[3]) : undefined];
  m = m ? null : /^(\d{1,2}) ([a-z]{3,9})\.?(?: (\d{4}))?$/.exec(t);
  if (m) [day, month, year] = [Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3)), m[3] ? Number(m[3]) : undefined];
  if (month === undefined || month < 0 || day === undefined) return null;
  const build = (y: number) => `${y}-${String(month! + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (year !== undefined) return isDateOnly(build(year)) ? build(year) : null;
  // No year: the date nearest today.
  const thisYear = Number(today.slice(0, 4));
  const options = [thisYear - 1, thisYear, thisYear + 1].map(build).filter(isDateOnly);
  options.sort((a, b) => Math.abs(daysBetween(a, today)) - Math.abs(daysBetween(b, today)));
  return options[0] ?? null;
}

function findProperty(text: string, properties: BulkProperty[]): { property: BulkProperty; rest: string } | null {
  const lower = text.toLowerCase();
  const sorted = [...properties].sort((a, b) => b.name.length - a.name.length);
  for (const property of sorted) {
    const name = property.name.toLowerCase();
    if (lower === name || lower.startsWith(`${name} `) || lower.startsWith(`${name},`) || lower.startsWith(`${name}\t`)) {
      return { property, rest: text.slice(property.name.length).replace(/^[\s,]+/, "") };
    }
  }
  return null;
}

/** "1-6" → 1…6. Anything else is a single unit. */
function expandUnit(unit: string): string[] | { error: string } {
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(unit);
  if (!m) return [unit];
  const [from, to] = [Number(m[1]), Number(m[2])];
  if (to <= from) return { error: `"${unit}" isn't a range from low to high` };
  if (to - from + 1 > MAX_RANGE) return { error: `A range can have at most ${MAX_RANGE} units` };
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}

export function parseBulk(
  input: string,
  properties: BulkProperty[],
  opts: { today: DateOnly; defaultMoveOut?: DateOnly | null; activeUnits?: Set<string> },
): BulkRow[] {
  const rows: BulkRow[] = [];
  const seen = new Set<string>();
  const lines = input.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || text.startsWith("#")) return;
    const line = index + 1;
    // A header row copied from a spreadsheet.
    if (/\bproperty\b/i.test(text) && /\bunit\b/i.test(text) && index === lines.findIndex((l) => l.trim())) return;

    const found = findProperty(text.replace(/\t/g, " ").trim(), properties) ?? findProperty(text, properties);
    if (!found) {
      const first = text.split(/[\s,\t]+/)[0];
      rows.push({ line, text, moveOutDate: null, error: `"${first}" isn't one of your properties` });
      return;
    }
    const cells = /[\t,]/.test(found.rest)
      ? found.rest.split(/[\t,]/).map((c) => c.trim())
      : [found.rest.split(/\s+/)[0] ?? "", found.rest.split(/\s+/).slice(1).join(" ")];
    const unitText = (cells[0] ?? "").trim();
    if (!unitText) {
      rows.push({ line, text, propertyId: found.property.id, propertyName: found.property.name, moveOutDate: null, error: "No unit" });
      return;
    }

    // Everything after the unit: up to two dates, move-out then target.
    const dateText = cells.slice(1).filter(Boolean);
    const dates: DateOnly[] = [];
    let dateError: string | undefined;
    const tokens = dateText.length === 1 ? splitDates(dateText[0]) : dateText;
    for (const token of tokens) {
      const d = parseLooseDate(token, opts.today);
      if (d) dates.push(d);
      else dateError = `"${token}" isn't a date the list understands (try 2026-11-15 or Nov 15)`;
    }
    if (dates.length > 2) dateError = "At most two dates: move-out, then target ready";

    const units = expandUnit(unitText);
    if (!Array.isArray(units)) {
      rows.push({ line, text, propertyId: found.property.id, propertyName: found.property.name, unit: unitText, moveOutDate: null, error: units.error });
      return;
    }
    for (const unit of units) {
      const key = `${found.property.id}|${unit.toLowerCase()}`;
      const row: BulkRow = {
        line,
        text,
        propertyId: found.property.id,
        propertyName: found.property.name,
        unit,
        moveOutDate: dates[0] ?? opts.defaultMoveOut ?? null,
        ...(dates[1] ? { targetReadyDate: dates[1] } : {}),
      };
      if (unit.length > 40) row.error = "The unit is too long";
      else if (dateError) row.error = dateError;
      else if (dates[0] && dates[1] && daysBetween(dates[1], dates[0]) < 0) row.error = "The target is before the move-out";
      else if (seen.has(key)) row.error = "Listed twice";
      else if (opts.activeUnits?.has(key)) row.warning = "Already has a turnover in progress";
      seen.add(key);
      rows.push(row);
    }
  });
  return rows;
}

/** "Nov 2 Nov 12" or "2026-11-02 2026-11-12" → two date strings. */
function splitDates(text: string): string[] {
  const iso = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g);
  if (iso && iso.join(" ").length >= text.replace(/\s+/g, " ").trim().length - 1) return iso;
  const words = text.match(/[a-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?|\d{1,2} [a-z]{3,9}\.?(?: \d{4})?/gi);
  return words && words.length > 0 ? words : [text];
}
