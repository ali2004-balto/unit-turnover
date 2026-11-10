"use server";

import { refresh } from "next/cache";
import { getSettings } from "@/db/settings";
import { dateInZone, isDateOnly } from "@/domain/dates";
import { importMasterTracker, type ImportReport } from "@/import/import-service";
import { type ParseResult, parseMasterTrackerCsv } from "@/import/master-tracker";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";

/** Far more than any Master Tracker export (one is a few kilobytes per hundred units). */
const MAX_CHARS = 900_000;

export interface ImportState {
  step: "choose" | "preview" | "done";
  error?: string;
  fileName?: string;
  exportedOn?: string;
  /** The previewed file, sent back with "Import" so the same file is imported. */
  csv?: string;
  found?: number;
  report?: ImportReport;
}

async function readFile(form: FormData): Promise<{ csv: string; fileName: string } | { error: string }> {
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CHARS) return { error: "That file is too big to be a Master Tracker export. Check it's the CSV of the Master Tracker tab." };
    return { csv: await file.text(), fileName: file.name.slice(0, 120) || "upload.csv" };
  }
  const csv = form.get("csv");
  if (typeof csv === "string" && csv.length > 0 && csv.length <= MAX_CHARS) {
    return { csv, fileName: String(form.get("fileName") ?? "upload.csv").slice(0, 120) };
  }
  return { error: "Choose the CSV file first." };
}

/**
 * Checks an export of the sheet's Master Tracker tab and shows exactly what
 * importing it would do (a real import, undone); then, when asked, imports it.
 * It only adds: units already in the app are skipped, and nobody is messaged.
 */
export async function importAction(_previous: ImportState, form: FormData): Promise<ImportState> {
  await requireManager("/settings/sheet");
  const mode = String(form.get("mode") ?? "preview");
  if (mode === "reset") return { step: "choose" };

  const upload = await readFile(form);
  if ("error" in upload) return { step: "choose", error: upload.error };
  let parsed: ParseResult;
  try {
    parsed = parseMasterTrackerCsv(upload.csv);
  } catch (error) {
    return { step: "choose", error: error instanceof Error ? error.message : "That file couldn't be read." };
  }
  if (parsed.rows.length === 0) return { step: "choose", error: "There are no units in that file." };

  const db = await getDb();
  const given = String(form.get("exportedOn") ?? "");
  const exportedOn = isDateOnly(given) ? given : dateInZone(new Date(), (await getSettings(db)).timezone);
  const importing = mode === "import";
  const report = await importMasterTracker(db, parsed, { file: upload.fileName, exportedOn, dryRun: !importing });
  if (importing) refresh();
  return {
    step: importing ? "done" : "preview",
    fileName: upload.fileName,
    exportedOn,
    csv: importing ? undefined : upload.csv,
    found: parsed.rows.length,
    report,
  };
}
