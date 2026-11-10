import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSettings } from "@/db/settings";
import { dateInZone } from "@/domain/dates";
import { importMasterTracker } from "@/import/import-service";
import { parseMasterTrackerCsv } from "@/import/master-tracker";
import { getDb } from "@/server/db";

export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * One-off, for the first import into a new deployment: imports the Master
 * Tracker CSV sent as the body, exactly as Settings > Google Sheet does.
 * `?mode=preview` (the default) works out what it would do and undoes it;
 * `?mode=import` imports. It needs `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const url = new URL(request.url);
  const importing = url.searchParams.get("mode") === "import";
  const csv = await request.text();
  if (!csv || csv.length > 900_000) return NextResponse.json({ error: "Send the CSV as the body." }, { status: 400 });
  const parsed = parseMasterTrackerCsv(csv);
  const db = await getDb();
  const exportedOn = dateInZone(new Date(), (await getSettings(db)).timezone);
  const file = url.searchParams.get("file")?.slice(0, 120) || "master-tracker.csv";
  const report = await importMasterTracker(db, parsed, { file, exportedOn, dryRun: !importing });
  return NextResponse.json({ mode: importing ? "import" : "preview", found: parsed.rows.length, exportedOn, report }, { headers: { "Cache-Control": "no-store" } });
}
