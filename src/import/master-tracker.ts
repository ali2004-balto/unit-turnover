/**
 * Reads a CSV export of the Master Tracker tab (File → Download →
 * Comma-separated values, with the Master Tracker tab selected).
 *
 * Columns are found by their header text, not their letter, so the import
 * keeps working if columns are moved. The grey calculated columns are read
 * too, but only to check the app's numbers against the sheet's.
 */
import Papa from "papaparse";
import { type DateOnly, daysBetween, fromSheetSerial, isDateOnly, MONTHS_SHORT, weekday } from "@/domain/dates";
import type { DerivedInput } from "@/domain/derived";
import { statusFromSheet, type StepStatus } from "@/domain/status";
import { unguardCell } from "@/lib/csv";

export const SHEET_STEP_KEYS = ["inspection", "scope", "work", "cleaning", "photos", "leasing"] as const;
export type SheetStepKey = (typeof SHEET_STEP_KEYS)[number];

/** The stage names the sheet's Current stage column uses. */
export const SHEET_STEP_NAMES: Record<SheetStepKey, string> = {
  inspection: "Inspection",
  scope: "Scope of work",
  work: "In-house work",
  cleaning: "Cleaning",
  photos: "Photos",
  leasing: "Leasing upload",
};

export interface SheetStep {
  key: SheetStepKey;
  /** null = blank cell. */
  status: StepStatus | null;
  date: DateOnly | null;
}

export interface SheetRow {
  /** Row number in the sheet (1-based), for messages. */
  rowNumber: number;
  property: string;
  unit: string;
  moveOutDate: DateOnly | null;
  targetReadyDate: DateOnly | null;
  steps: SheetStep[];
  scopeOfWork: string;
  assignedTo: string;
  notes: string;
  /** What the sheet's own formulas showed when it was exported. */
  sheetComputed: {
    currentStage: string;
    daysVacant: number | null;
    daysInStage: number | null;
    flag: string;
  };
}

export interface ImportWarning {
  rowNumber: number;
  column: string;
  message: string;
}

export interface ParseResult {
  rows: SheetRow[];
  warnings: ImportWarning[];
}

type Field =
  | "property"
  | "unit"
  | "moveOut"
  | "target"
  | "currentStage"
  | "daysVacant"
  | "daysInStage"
  | "flag"
  | `${SheetStepKey}Status`
  | `${SheetStepKey}Date`
  | "scopeText"
  | "assignedTo"
  | "notes";

/** Header text (lower case) accepted for each field. */
const HEADERS: Record<Field, string[]> = {
  property: ["property"],
  unit: ["unit"],
  moveOut: ["move-out date", "move out date", "moveout date"],
  target: ["target ready date", "target date"],
  currentStage: ["current stage"],
  daysVacant: ["days vacant"],
  daysInStage: ["days in stage"],
  flag: ["flag"],
  inspectionStatus: ["inspection status"],
  inspectionDate: ["inspection date"],
  scopeStatus: ["scope status"],
  scopeDate: ["scope date"],
  scopeText: ["scope of work (what's required)", "scope of work"],
  workStatus: ["work status"],
  workDate: ["work date"],
  assignedTo: ["assigned to (employee)", "assigned to"],
  cleaningStatus: ["cleaning status"],
  cleaningDate: ["cleaning date"],
  photosStatus: ["photos status"],
  photosDate: ["photos date"],
  leasingStatus: ["leasing status"],
  leasingDate: ["leasing date"],
  notes: ["notes / blockers", "notes"],
};

/** Column names as the sheet writes them, for messages. */
const LABELS: Record<Field, string> = {
  property: "Property",
  unit: "Unit",
  moveOut: "Move-out date",
  target: "Target ready date",
  currentStage: "Current stage",
  daysVacant: "Days vacant",
  daysInStage: "Days in stage",
  flag: "Flag",
  inspectionStatus: "Inspection status",
  inspectionDate: "Inspection date",
  scopeStatus: "Scope status",
  scopeDate: "Scope date",
  scopeText: "Scope of work (what's required)",
  workStatus: "Work status",
  workDate: "Work date",
  assignedTo: "Assigned to (employee)",
  cleaningStatus: "Cleaning status",
  cleaningDate: "Cleaning date",
  photosStatus: "Photos status",
  photosDate: "Photos date",
  leasingStatus: "Leasing status",
  leasingDate: "Leasing date",
  notes: "Notes / blockers",
};

const REQUIRED: Field[] = ["property", "unit", ...SHEET_STEP_KEYS.map((k) => `${k}Status` as Field)];

function normalizeHeader(text: string): string {
  return text.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
}

const MONTH_INDEX = new Map(MONTHS_SHORT.map((m, i) => [m.toLowerCase(), i + 1]));

/** Reads a date cell. Accepts 2026-11-06, 2026/11/06, Nov 6, 2026, 6 Nov 2026 and sheet serials. */
export function parseDateCell(raw: string): { date: DateOnly | null; error?: string } {
  const text = raw.trim();
  if (text === "") return { date: null };

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return isDateOnly(date) ? { date } : { date: null, error: `"${text}" is not a real date` };
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) return { date: fromSheetSerial(Number(text)) };

  m = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(text) ?? null;
  let day: string | undefined, month: string | undefined, year: string | undefined;
  if (m) [, month, day, year] = m;
  else {
    const m2 = /^(\d{1,2})[\s-]([a-z]{3,9})\.?[\s,-]+(\d{4})$/i.exec(text);
    if (m2) [, day, month, year] = m2;
  }
  if (day && month && year) {
    const mo = MONTH_INDEX.get(month.slice(0, 3).toLowerCase());
    const date = mo ? `${year}-${String(mo).padStart(2, "0")}-${day.padStart(2, "0")}` : "";
    if (isDateOnly(date)) return { date };
  }
  return { date: null, error: `"${text}" isn't a date the import understands; use YYYY-MM-DD` };
}

function parseNumberCell(raw: string): number | null {
  const t = raw.trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseMasterTrackerCsv(csv: string): ParseResult {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const grid = parsed.data;
  const warnings: ImportWarning[] = [];

  const headerIndex = grid.findIndex((r) => {
    const cells = r.map(normalizeHeader);
    return cells.includes("property") && cells.includes("unit");
  });
  if (headerIndex === -1) {
    throw new Error('Could not find the header row (a row with "Property" and "Unit"). Is this the Master Tracker tab?');
  }

  const header = grid[headerIndex].map(normalizeHeader);
  const col = {} as Record<Field, number>;
  for (const [field, names] of Object.entries(HEADERS) as Array<[Field, string[]]>) {
    col[field] = header.findIndex((h) => names.includes(h));
  }
  const missing = REQUIRED.filter((f) => col[f] === -1);
  if (missing.length > 0) {
    throw new Error(`The header row is missing: ${missing.map((f) => LABELS[f]).join(", ")}`);
  }

  const rows: SheetRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    const rowNumber = i + 1;
    // A file exported by the app guards text that looks like a formula with an apostrophe; drop it.
    const cell = (f: Field) => (col[f] === -1 ? "" : unguardCell((cells[col[f]] ?? "").trim()));
    const property = cell("property");
    const unit = cell("unit");
    // The sheet ignores rows with no property and no unit.
    if (property === "" && unit === "") continue;

    const date = (f: Field) => {
      const { date: d, error } = parseDateCell(cell(f));
      if (error) warnings.push({ rowNumber, column: LABELS[f], message: error });
      return d;
    };

    // Left to right, so warnings come out in column order.
    const moveOutDate = date("moveOut");
    const targetReadyDate = date("target");
    const steps: SheetStep[] = SHEET_STEP_KEYS.map((key) => {
      const raw = cell(`${key}Status`);
      let status = statusFromSheet(raw);
      if (status === undefined) {
        warnings.push({ rowNumber, column: LABELS[`${key}Status`], message: `Unknown status "${raw}", treated as blank` });
        status = null;
      }
      return { key, status, date: date(`${key}Date`) };
    });

    rows.push({
      rowNumber,
      property,
      unit,
      moveOutDate,
      targetReadyDate,
      steps,
      scopeOfWork: cell("scopeText"),
      assignedTo: cell("assignedTo"),
      notes: cell("notes"),
      sheetComputed: {
        currentStage: cell("currentStage"),
        daysVacant: parseNumberCell(cell("daysVacant")),
        daysInStage: parseNumberCell(cell("daysInStage")),
        flag: cell("flag"),
      },
    });
  }
  return { rows, warnings };
}

/** The sheet row exactly as the sheet's formulas see it. */
export function sheetRowToDerivedInput(row: SheetRow): DerivedInput {
  return {
    moveOutDate: row.moveOutDate,
    targetReadyDate: row.targetReadyDate,
    steps: row.steps.map((s) => ({ name: SHEET_STEP_NAMES[s.key], status: s.status })),
    stepDates: row.steps.map((s) => s.date),
  };
}

export interface ScopeItem {
  text: string;
  toConfirm: boolean;
}

const TO_CONFIRM = /\(?\s*\bto (?:be )?confirm(?:ed)?\b\s*\)?/i;

/**
 * Splits "Scope of work" text into checklist items. Items are separated by
 * semicolons; if there are none, by commas ("3 doors, 1 drawer, new stove").
 * "(to confirm)" marks an item as waiting on a decision.
 */
export function splitScope(text: string): ScopeItem[] {
  const separator = text.includes(";") ? ";" : ",";
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const toConfirm = TO_CONFIRM.test(part);
      const cleaned = toConfirm ? part.replace(TO_CONFIRM, " ").replace(/\s+/g, " ").trim() : part;
      return { text: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), toConfirm };
    });
}

const STEP_WORDS: Record<string, SheetStepKey> = {
  inspection: "inspection",
  scope: "scope",
  work: "work",
  cleaning: "cleaning",
  clean: "cleaning",
  photo: "photos",
  photos: "photos",
  leasing: "leasing",
};

export interface Booking {
  on: DateOnly;
  /** False when the note's weekday doesn't match the date ("Sat Nov 15"). */
  weekdayMatches: boolean;
}

/**
 * Finds bookings written in notes, e.g. "Cleaning scheduled Sun Nov 8; photos
 * scheduled Sat Nov 14". Notes don't include a year, so the date nearest the
 * export date is used.
 */
export function parseBookings(notes: string, referenceDate: DateOnly): Partial<Record<SheetStepKey, Booking>> {
  const found: Partial<Record<SheetStepKey, Booking>> = {};
  const re =
    /\b(inspection|scope|work|cleaning|clean|photos?|leasing)\s+(?:is\s+|are\s+)?(?:scheduled|booked)\s+(?:for\s+|on\s+)?(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  for (const m of notes.matchAll(re)) {
    const key = STEP_WORDS[m[1].toLowerCase()];
    const month = MONTH_INDEX.get(m[3].toLowerCase())!;
    const day = m[4].padStart(2, "0");
    const refYear = Number(referenceDate.slice(0, 4));
    const candidates = [refYear - 1, refYear, refYear + 1]
      .map((y) => `${y}-${String(month).padStart(2, "0")}-${day}`)
      .filter(isDateOnly)
      .sort((a, b) => Math.abs(daysBetween(a, referenceDate)) - Math.abs(daysBetween(b, referenceDate)));
    const on = candidates[0];
    if (!key || !on || found[key]) continue;
    const weekdayWord = m[2]?.toLowerCase();
    const weekdayMatches =
      !weekdayWord || ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekdayWord) === weekday(on);
    found[key] = { on, weekdayMatches };
  }
  return found;
}
