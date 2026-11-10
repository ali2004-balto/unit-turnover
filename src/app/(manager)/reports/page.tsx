import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatShort } from "@/domain/dates";
import { parseReportPeriod, REPORT_PERIODS, type Report } from "@/domain/reports";
import { cn } from "@/lib/utils";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { loadReport } from "@/server/queries/reports";
import { ColumnChart } from "./column-chart";
import { ReportFilters } from "./report-filters";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">How long turns take, where units wait, and how often work comes back.</p>
      <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="mt-6 h-96 animate-pulse rounded-lg bg-muted" />}>
        <ReportContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

const days = (n: number | null) => (n === null ? "–" : n.toFixed(1));
const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function ReportContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  await requireManager("/reports");
  await connection();
  const period = parseReportPeriod(params.period);
  const propertyParam = typeof params.property === "string" ? params.property : null;
  const { report, properties } = await loadReport(await getDb(), { period, propertyId: propertyParam });
  const property = properties.some((p) => p.id === propertyParam) ? propertyParam : null;
  const nothing = report.completed.length === 0 && report.steps.length === 0 && report.totals.sendBacks === 0;

  return (
    <div className="mt-5 space-y-6">
      <ReportFilters period={period} property={property} properties={properties} />
      <p className="text-xs text-muted-foreground">
        {REPORT_PERIODS[period]}: {formatShort(report.from)} to {formatShort(report.to)}
        {property ? `, ${properties.find((p) => p.id === property)?.name}` : ", all properties"}.
      </p>
      {nothing ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="font-medium">Nothing finished in this period yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reports fill in as turnovers move through their steps.{" "}
            {period !== "all" ? (
              <Link href={`/reports?period=all${property ? `&property=${property}` : ""}`} className="text-primary underline underline-offset-2">
                Try all time
              </Link>
            ) : null}
          </p>
        </div>
      ) : (
        <>
          <Totals report={report} />
          <StepTimes report={report} />
          <Trend report={report} />
          <ByProperty report={report} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ByPerson report={report} />
            <Rework report={report} />
          </div>
          <Finished report={report} />
        </>
      )}
    </div>
  );
}

/** A wide table that scrolls sideways on small screens; focusable so it can be scrolled from the keyboard. */
function Scroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {children}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Totals({ report: { totals } }: { report: Report }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Turnovers finished" value={String(totals.completed)} note="Rent-ready in this period" />
      <Tile
        label="Average days vacant"
        value={days(totals.avgDaysVacant)}
        note={totals.medianDaysVacant === null ? "Move-out to rent-ready" : `Median ${days(totals.medianDaysVacant)}`}
      />
      <Tile
        label="On time"
        value={pct(totals.onTimeRate)}
        note={totals.withTarget ? `${totals.onTime} of ${totals.withTarget} with a target date` : "None had a target date"}
      />
      <Tile
        label="Sent back"
        value={pct(totals.reworkRate)}
        note={`Of finished turnovers; ${plural(totals.sendBacks, "send-back")} in all`}
      />
    </div>
  );
}

function StepTimes({ report }: { report: Report }) {
  if (report.steps.length === 0) {
    return (
      <Section title="Where units wait">
        <p className="text-sm text-muted-foreground">No steps finished in the app in this period. Steps finished in the sheet before the app took over have no times.</p>
      </Section>
    );
  }
  const max = Math.max(...report.steps.map((s) => s.avgDays));
  const slowest = report.steps.find((s) => s.name === report.bottleneck)!;
  return (
    <Section
      title="Where units wait"
      description={
        <>
          Average days at each step, from when it became someone&apos;s turn to done (send-backs included). The slowest is{" "}
          <strong className="font-medium text-foreground">{slowest.name}</strong>, at {days(slowest.avgDays)} days.
        </>
      }
    >
      <Scroll label="Average days at each step">
        <table className="w-full text-sm sm:min-w-[34rem]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-40 py-1.5 pr-3 font-medium">Step</th>
              <th className="py-1.5 pr-3 font-medium">Average days</th>
              <th className="py-1.5 pr-3 text-right font-medium">Done</th>
              <th className="hidden py-1.5 pr-3 text-right font-medium sm:table-cell">Median</th>
              <th className="hidden py-1.5 font-medium sm:table-cell">Longest</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {report.steps.map((s) => (
              <tr key={s.name} className="border-t border-border">
                <td className="py-2 pr-3">{s.name}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-3 flex-1">
                      <div
                        className={cn("h-full rounded-r", s.name === report.bottleneck ? "bg-chart-accent" : "bg-chart-muted")}
                        style={{ width: `${Math.max(1, (s.avgDays / max) * 100)}%` }}
                      />
                    </div>
                    <span className={cn("w-10 text-right", s.name === report.bottleneck && "font-semibold")}>{days(s.avgDays)}</span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right">{s.count}</td>
                <td className="hidden py-2 pr-3 text-right sm:table-cell">{days(s.medianDays)}</td>
                <td className="hidden py-2 text-muted-foreground sm:table-cell">
                  {s.longest.label}, {days(s.longest.days)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </Section>
  );
}

function Trend({ report }: { report: Report }) {
  const { unit, points } = report.trend;
  const per = unit === "week" ? "week" : "month";
  return (
    <Section title="Days vacant over time" description={`Average days from move-out to rent-ready, for turnovers finished each ${per}.`}>
      <ColumnChart
        description={`Average days vacant by ${per}`}
        values="days"
        columns={points.map((p) => ({
          key: p.start,
          label: p.label,
          value: p.avgDaysVacant,
          detail: p.completed ? `${plural(p.completed, "turnover")} finished` : "None finished",
        }))}
      />
      <h3 className="mt-6 text-sm font-medium">On time</h3>
      <p className="text-sm text-muted-foreground">Share finished by their target date, each {per}.</p>
      <div className="mt-3">
        <ColumnChart
          description={`Share finished on time by ${per}`}
          values="percent"
          columns={points.map((p) => ({
            key: p.start,
            label: p.label,
            value: p.onTimeRate,
            detail: p.completed ? `${plural(p.completed, "turnover")} finished` : "None finished",
          }))}
        />
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full max-w-lg text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">{unit === "week" ? "Week of" : "Month"}</th>
              <th className="py-1 text-right font-medium">Finished</th>
              <th className="py-1 text-right font-medium">Average days vacant</th>
              <th className="py-1 text-right font-medium">On time</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.start} className="border-t border-border">
                <td className="py-1">{p.label}</td>
                <td className="py-1 text-right">{p.completed}</td>
                <td className="py-1 text-right">{days(p.avgDaysVacant)}</td>
                <td className="py-1 text-right">{pct(p.onTimeRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Section>
  );
}

function ByProperty({ report }: { report: Report }) {
  if (report.byProperty.length === 0) return null;
  const cells = report.byProperty.flatMap((p) => Object.values(p.stepAvg)).filter((v): v is number => v !== null);
  const max = Math.max(0, ...cells);
  const level = (v: number) => (max === 0 ? 1 : Math.min(5, Math.max(1, Math.ceil((v / max) * 5))));
  return (
    <Section title="By property" description="Average days at each step; darker is slower. Each property's slowest step is its bottleneck.">
      <Scroll label="Days at each step by property">
        <table className="w-full min-w-[44rem] text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 bg-card py-1.5 pr-3 font-medium">Property</th>
              <th className="py-1.5 pr-3 text-right font-medium">Finished</th>
              <th className="py-1.5 pr-3 text-right font-medium">Days vacant</th>
              <th className="py-1.5 pr-3 text-right font-medium">On time</th>
              {report.stepNames.map((name) => (
                <th key={name} className="px-1 py-1.5 text-center font-medium">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.byProperty.map((p) => (
              <tr key={p.propertyId} className="border-t border-border">
                <td className="sticky left-0 bg-card py-1.5 pr-3 font-medium whitespace-nowrap">{p.property}</td>
                <td className="py-1.5 pr-3 text-right">{p.completed}</td>
                <td className="py-1.5 pr-3 text-right">{days(p.avgDaysVacant)}</td>
                <td className="py-1.5 pr-3 text-right">{pct(p.onTimeRate)}</td>
                {report.stepNames.map((name) => {
                  const v = p.stepAvg[name];
                  return (
                    <td key={name} className="p-0.5">
                      {v === null ? (
                        <span className="block py-1 text-center text-muted-foreground">–</span>
                      ) : (
                        <span
                          className={cn("block rounded py-1 text-center", name === p.slowestStep && "font-semibold")}
                          style={{ background: `var(--heat-${level(v)})`, color: `var(--heat-ink-${level(v)})` }}
                          title={`${p.property}, ${name}: ${days(v)} days on average`}
                        >
                          {days(v)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        <span>Fewer days</span>
        {[1, 2, 3, 4, 5].map((l) => (
          <span key={l} className="h-3 w-6 rounded-sm" style={{ background: `var(--heat-${l})` }} />
        ))}
        <span>More days</span>
      </div>
    </Section>
  );
}

function ByPerson({ report }: { report: Report }) {
  return (
    <Section title="By person" description="Steps each person finished in this period.">
      {report.byPerson.length === 0 ? (
        <p className="text-sm text-muted-foreground">No steps finished in this period.</p>
      ) : (
        <Scroll label="Steps by person">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Person</th>
                <th className="py-1.5 pr-3 text-right font-medium">Steps</th>
                <th className="py-1.5 pr-3 text-right font-medium">Avg days</th>
                <th className="py-1.5 pr-3 text-right font-medium">By due date</th>
                <th className="py-1.5 text-right font-medium">Sent back</th>
              </tr>
            </thead>
            <tbody>
              {report.byPerson.map((p) => (
                <tr key={p.personId} className="border-t border-border">
                  <td className="py-1.5 pr-3">{p.name}</td>
                  <td className="py-1.5 pr-3 text-right">{p.stepsDone}</td>
                  <td className="py-1.5 pr-3 text-right">{days(p.avgDays)}</td>
                  <td className="py-1.5 pr-3 text-right">{pct(p.onTimeRate)}</td>
                  <td className="py-1.5 text-right">{p.sentBack}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
    </Section>
  );
}

function CountBars({ rows }: { rows: Array<{ step: string; count: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.step} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-2">
          <span className="truncate">{r.step}</span>
          <span className="h-3">
            <span className="block h-full rounded-r bg-chart-accent" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Rework({ report }: { report: Report }) {
  const { rework, totals } = report;
  return (
    <Section
      title="Rework"
      description={
        totals.sendBacks === 0
          ? "Nothing was sent back in this period."
          : `${plural(totals.sendBacks, "send-back")} in this period. ${pct(totals.reworkRate)} of finished turnovers were sent back at least once.`
      }
    >
      {totals.sendBacks > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Work that had to be redone</h3>
            <CountBars rows={rework.byToStep} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Spotted at</h3>
            <CountBars rows={rework.byFromStep} />
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function Finished({ report }: { report: Report }) {
  if (report.completed.length === 0) return null;
  const SHOWN = 50;
  const rows = [...report.completed].reverse().slice(0, SHOWN);
  return (
    <Section
      title="Turnovers finished"
      description={report.completed.length > SHOWN ? `The latest ${SHOWN}; the CSV has all ${report.completed.length}.` : "Latest first."}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Unit</th>
              <th className="py-1.5 pr-3 font-medium">Moved out</th>
              <th className="py-1.5 pr-3 font-medium">Rent-ready</th>
              <th className="py-1.5 pr-3 text-right font-medium">Days vacant</th>
              <th className="py-1.5 pr-3 font-medium">Target</th>
              <th className="py-1.5 pr-3 font-medium">On time</th>
              <th className="py-1.5 text-right font-medium">Sent back</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <Link href={`/turnovers/${c.id}`} className="font-medium hover:underline">
                    {c.label}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{c.moveOutDate ? formatShort(c.moveOutDate) : "–"}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{formatShort(c.readyOn)}</td>
                <td className="py-1.5 pr-3 text-right">{c.daysVacant ?? "–"}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{c.targetReadyDate ? formatShort(c.targetReadyDate) : "–"}</td>
                <td className="py-1.5 pr-3">{c.onTime === null ? "–" : c.onTime ? "Yes" : "Late"}</td>
                <td className="py-1.5 text-right">{c.sendBacks || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
