import { connection } from "next/server";
import { getDb } from "@/server/db";
import { sheetLinkMatches, trackerCsv } from "@/server/queries/tracker-export";

/**
 * The Master Tracker for Google Sheets' IMPORTDATA, so a tab in your sheet
 * stays up to date. The secret in the link is the only key: turn the link off
 * or replace it in Settings, Google Sheet.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/sheet/[token]/master-tracker.csv">) {
  await connection();
  const { token } = await ctx.params;
  const db = await getDb();
  if (!(await sheetLinkMatches(db, token))) return new Response("Not found", { status: 404 });
  return new Response(await trackerCsv(db), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
