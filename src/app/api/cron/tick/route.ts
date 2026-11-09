import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { messageBaseUrl, runNotifications } from "@/server/notifications/run";

export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The scheduler calls this every few minutes (see vercel.json): it writes the
 * morning reminders when it's time and sends anything due, such as retries
 * and texts held for quiet hours. It needs `Authorization: Bearer <CRON_SECRET>`,
 * which Vercel's scheduler adds by itself once CRON_SECRET is set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Set CRON_SECRET to turn on scheduled messages." }, { status: 503 });
    }
  } else if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const report = await runNotifications(await getDb(), { baseUrl: messageBaseUrl(new URL(request.url).origin) });
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
