import { connection } from "next/server";
import { formatShort } from "@/domain/dates";
import { parseReportPeriod } from "@/domain/reports";
import { toCsv } from "@/lib/csv";
import { getCurrentSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { loadReport } from "@/server/queries/reports";

/** The turnovers finished in a report's period, one row each, for a spreadsheet. Managers only. */
export async function GET(request: Request) {
  await connection();
  const session = await getCurrentSession();
  if (!session?.person.roles.includes("admin")) return new Response("Sign in as a manager first.", { status: 401 });
  const params = new URL(request.url).searchParams;
  const period = parseReportPeriod(params.get("period"));
  const { report } = await loadReport(await getDb(), { period, propertyId: params.get("property") });
  const rows: unknown[][] = [
    ["Property", "Unit", "Moved out", "Target ready", "Rent-ready", "Days vacant", "On time", "Send-backs", ...report.stepNames.map((n) => `${n} (days)`)],
    ...report.completed.map((c) => [
      c.property,
      c.label.slice(c.property.length + 1),
      c.moveOutDate ?? "",
      c.targetReadyDate ?? "",
      c.readyOn,
      c.daysVacant ?? "",
      c.onTime === null ? "" : c.onTime ? "Yes" : "No",
      c.sendBacks,
      ...report.stepNames.map((n) => (c.stepDays[n] == null ? "" : Number(c.stepDays[n]!.toFixed(1)))),
    ]),
  ];
  const name = `turnover-report-${report.from}-to-${report.to}.csv`;
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Report-Range": `${formatShort(report.from)} to ${formatShort(report.to)}`,
    },
  });
}
