/**
 * The Master Tracker as a spreadsheet, laid out exactly like your sheet's
 * Master Tracker tab: the title row, the step headings, the same 23 columns in
 * the same places, one row per unit from row 4. So a Google Sheet can use it
 * where the old tab was, and a Summary tab's formulas keep working.
 *
 * The grey columns (current stage, days vacant, days in stage, flag) hold the
 * app's results, which follow the sheet's formulas. A step's date is when it
 * was done, or its booking date while it's Scheduled, as in the sheet.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { appSettings } from "@/db/schema";
import { getSettings } from "@/db/settings";
import { STATUS_LABELS } from "@/domain/status";
import type { StepState } from "@/domain/workflow/types";
import { toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { listTurnovers, type TurnoverList, type TurnoverView } from "./turnovers";

/** Row 2 of the sheet. */
export const TRACKER_GROUPS = [
  "UNIT", "", "", "",
  "AUTO-CALCULATED (don't type here)", "", "", "",
  "STEP 1: INSPECTION", "",
  "STEP 2: WHAT'S REQUIRED", "", "",
  "STEP 3: IN-HOUSE WORK (OUR EMPLOYEES)", "", "",
  "STEP 4: CLEANING", "",
  "STEP 5: PHOTOS", "",
  "STEP 6: UPLOAD TO LEASING", "",
  "NOTES",
]; // prettier-ignore

/** Row 3 of the sheet: the column headings. */
export const TRACKER_HEADERS = [
  "Property", "Unit", "Move-out date", "Target ready date",
  "Current stage", "Days vacant", "Days in stage", "Flag",
  "Inspection status", "Inspection date",
  "Scope status", "Scope date", "Scope of work (what's required)",
  "Work status", "Work date", "Assigned to (employee)",
  "Cleaning status", "Cleaning date",
  "Photos status", "Photos date",
  "Leasing status", "Leasing date",
  "Notes / blockers",
]; // prettier-ignore

function stepCells(s: StepState | undefined): [string, string] {
  if (!s) return ["", ""];
  const date = s.status === "done" || s.status === "na" ? s.completedOn : s.status === "scheduled" ? s.scheduledOn : null;
  return [STATUS_LABELS[s.status], date ?? ""];
}

/** The scope the way the sheet writes it: items separated by semicolons. */
function scopeText(scope: StepState | undefined): string {
  if (!scope) return "";
  return [...scope.checklist]
    .filter((c) => c.state !== "dropped")
    .sort((a, b) => a.position - b.position)
    .map((c) => (c.state === "to_confirm" ? `${c.text} (to confirm)` : c.text))
    .join("; ");
}

export function trackerRow(row: TurnoverView, nameOf: (id: string | null) => string | null): unknown[] {
  const { turnover: t, derived } = row;
  const step = (key: string) => t.steps.find((s) => s.key === key);
  const work = step("work");
  const blockers = t.steps.filter((s) => s.status === "blocked").map((s) => `Blocked at ${s.name}: ${s.blockedReason ?? "no reason given"}`);
  return [
    row.propertyName,
    t.unit,
    t.moveOutDate ?? "",
    t.targetReadyDate ?? "",
    derived.currentStage,
    derived.daysVacant ?? "",
    derived.daysInStage ?? "",
    derived.flag,
    ...stepCells(step("inspection")),
    ...stepCells(step("scope")),
    scopeText(step("scope")),
    ...stepCells(work),
    nameOf(work?.assigneeId ?? null) ?? "",
    ...stepCells(step("cleaning")),
    ...stepCells(step("photos")),
    ...stepCells(step("leasing")),
    [t.notes, ...blockers].filter(Boolean).join(" | "),
  ];
}

export function trackerTable(list: TurnoverList, madeAt: string): unknown[][] {
  const nameOf = (id: string | null) => (id ? (list.people.get(id)?.name ?? null) : null);
  const title = ["UNIT TURNOVER MASTER TRACKER", "", "", "", `From the Unit Turnover app (${madeAt}). Make changes in the app: this copy is replaced.`];
  return [
    [...title, ...Array(TRACKER_HEADERS.length - title.length).fill("")],
    TRACKER_GROUPS,
    TRACKER_HEADERS,
    ...list.rows.map((row) => trackerRow(row, nameOf)),
  ];
}

export async function trackerCsv(ex: Executor, now = new Date()): Promise<string> {
  const list = await listTurnovers(ex);
  return toCsv(trackerTable(list, formatDateTime(now, list.settings.timezone)));
}

// ── The live link ───────────────────────────────────────────────────────────

/** Turns the live link on (or replaces it, so the old one stops working). */
export async function newSheetLink(ex: Executor): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await ex.update(appSettings).set({ sheetLinkToken: token, updatedAt: new Date() }).where(eq(appSettings.id, 1));
  return token;
}

export async function removeSheetLink(ex: Executor): Promise<void> {
  await ex.update(appSettings).set({ sheetLinkToken: null, updatedAt: new Date() }).where(eq(appSettings.id, 1));
}

export async function sheetLinkMatches(ex: Executor, given: string): Promise<boolean> {
  const { sheetLinkToken } = await getSettings(ex);
  if (!sheetLinkToken || !given) return false;
  // Compare digests so the comparison takes the same time whatever the input.
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(given), digest(sheetLinkToken));
}

export const sheetLinkUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/+$/, "")}/api/sheet/${token}/master-tracker.csv`;
