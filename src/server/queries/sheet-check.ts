/**
 * Recomputes the bundled snapshot of your sheet with the app's formulas and
 * compares the results with what the sheet's own formulas showed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { derive, type Flag } from "@/domain/derived";
import { summarize, type Summary } from "@/domain/summary";
import { parseMasterTrackerCsv, SHEET_STEP_KEYS, SHEET_STEP_NAMES, sheetRowToDerivedInput } from "@/import/master-tracker";

const SNAPSHOT = "master-tracker-2026-11-09";

export interface SheetCheckRow {
  label: string;
  rowNumber: number;
  sheet: { currentStage: string; daysVacant: number | null; daysInStage: number | null; flag: string };
  app: { currentStage: string; daysVacant: number | null; daysInStage: number | null; flag: Flag };
  matches: boolean;
}

export interface SheetCheck {
  file: string;
  exportedOn: string;
  rows: SheetCheckRow[];
  summaryMatches: boolean;
  summary: Omit<Summary, "crew">;
}

export function checkSheetSnapshot(): SheetCheck {
  const dir = path.join(process.cwd(), "data", "import");
  const csv = readFileSync(path.join(dir, `${SNAPSHOT}.csv`), "utf8");
  const expected = JSON.parse(readFileSync(path.join(dir, `${SNAPSHOT}.summary.json`), "utf8"));
  const parsed = parseMasterTrackerCsv(csv);

  const rows = parsed.rows.map((r): SheetCheckRow => {
    const d = derive(sheetRowToDerivedInput(r), expected.exportedOn, expected.dueSoonDays);
    const app = { currentStage: d.currentStage, daysVacant: d.daysVacant, daysInStage: d.daysInStage, flag: d.flag };
    return {
      label: `${r.property} ${r.unit}`,
      rowNumber: r.rowNumber,
      sheet: r.sheetComputed,
      app,
      matches: isDeepStrictEqual(app, r.sheetComputed),
    };
  });

  const { crew: _crew, ...summary } = summarize(
    parsed.rows.map((r) => ({
      derived: derive(sheetRowToDerivedInput(r), expected.exportedOn, expected.dueSoonDays),
      moveOutDate: r.moveOutDate,
      work: [{ assigneeName: r.assignedTo || null, status: r.steps[2].status }],
    })),
    SHEET_STEP_KEYS.map((k, i) => `${i + 1}. ${SHEET_STEP_NAMES[k]}`),
    expected.inHouseEmployees,
  );

  return {
    file: `${SNAPSHOT}.csv`,
    exportedOn: expected.exportedOn,
    rows,
    summary,
    summaryMatches: isDeepStrictEqual(summary, expected.summary),
  };
}
