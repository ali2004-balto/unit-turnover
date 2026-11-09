import { connection } from "next/server";
import { getSettings } from "@/db/settings";
import { dateInZone } from "@/domain/dates";
import { getCurrentSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { trackerCsv } from "@/server/queries/tracker-export";

/** The Master Tracker as a CSV file, laid out like the sheet. Managers only. */
export async function GET() {
  await connection();
  const session = await getCurrentSession();
  if (!session?.person.roles.includes("admin")) return new Response("Sign in as a manager first.", { status: 401 });
  const db = await getDb();
  const now = new Date();
  const today = dateInZone(now, (await getSettings(db)).timezone);
  return new Response(await trackerCsv(db, now), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="master-tracker-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
