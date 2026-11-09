/**
 * npm run db:import -- <file.csv> [--date YYYY-MM-DD] [--replace]
 *
 * Imports a CSV export of the Master Tracker tab (in Google Sheets: select
 * the Master Tracker tab, then File → Download → Comma-separated values).
 *
 *   --date      the day you exported it, so notes like "Sat Nov 14" get the
 *               right year (defaults to today)
 *   --replace   delete every turnover in the database first
 *
 * Units already in the app (same property, unit and move-out date) are skipped.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { migrateDatabase, openDatabase } from "@/db/client";
import { getSettings } from "@/db/settings";
import { dateInZone, isDateOnly } from "@/domain/dates";
import { importMasterTracker } from "@/import/import-service";
import { parseMasterTrackerCsv } from "@/import/master-tracker";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const file = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--date");
  if (!file) {
    console.error("Usage: npm run db:import -- <file.csv> [--date YYYY-MM-DD] [--replace]");
    process.exit(1);
  }
  const parsed = parseMasterTrackerCsv(await readFile(file, "utf8"));

  const handle = await openDatabase();
  try {
    await migrateDatabase(handle);
    const settings = await getSettings(handle.db);
    const exportedOn = arg("--date") ?? dateInZone(new Date(), settings.timezone);
    if (!isDateOnly(exportedOn)) throw new Error("--date must be written YYYY-MM-DD");

    const report = await importMasterTracker(handle.db, parsed, {
      file: path.basename(file),
      exportedOn,
      replace: process.argv.includes("--replace"),
    });

    console.log(`Imported ${report.created} turnover(s) from ${path.basename(file)}.`);
    if (report.newProperties.length) console.log(`New properties: ${report.newProperties.join(", ")}`);
    if (report.newPeople.length) console.log(`New in-house employees: ${report.newPeople.join(", ")}`);
    for (const s of report.skipped) console.log(`Skipped row ${s.rowNumber}: ${s.reason}`);
    for (const w of report.warnings) console.log(`Row ${w.rowNumber}, ${w.column}: ${w.message}`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
