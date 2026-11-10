import Link from "next/link";
import { connection } from "next/server";
import { FlagPill, STATUS_STYLES, StatusPill } from "@/components/status";
import { CrewTable, PipelineTable } from "@/components/summary-tables";
import { isDateOnly } from "@/domain/dates";
import { stageLabel } from "@/domain/derived";
import { STATUS_LABELS } from "@/domain/status";
import { type Summary, summarize } from "@/domain/summary";
import type { StepState } from "@/domain/workflow/types";
import { formatAverage, formatBooking, formatDate, formatDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { checkSheetSnapshot, type SheetCheck } from "@/server/queries/sheet-check";
import { listTurnovers, type PersonSummary, type TurnoverView } from "@/server/queries/turnovers";
import { DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import { WorkflowError } from "@/domain/workflow/errors";
import { loadTemplate } from "@/server/workflow";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function TrackerContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await requireManager("/tracker");
  await connection();
  const asOf = typeof params.asOf === "string" && isDateOnly(params.asOf) ? params.asOf : undefined;

  const db = await getDb();
  const [list, templateSteps] = await Promise.all([
    listTurnovers(db, { today: asOf }),
    // A brand-new database has no template until setup runs; show the standard six steps.
    loadTemplate(db).then(
      (t) => t.steps,
      (error: unknown) => {
        if (error instanceof WorkflowError && error.code === "NOT_FOUND") return DEFAULT_TEMPLATE_STEPS;
        throw error;
      },
    ),
  ]);
  const columns = templateSteps.map((s) => ({ key: s.key, name: s.name }));
  const crewNames = [...list.people.values()]
    .filter((p) => p.roles.includes("crew"))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
  const nameOf = (id: string | null) => (id ? (list.people.get(id)?.name ?? null) : null);
  const summary = summarize(
    list.rows.map((r) => ({
      derived: r.derived,
      moveOutDate: r.turnover.moveOutDate,
      work: r.turnover.steps.filter((s) => s.kind === "work").map((s) => ({ assigneeName: nameOf(s.assigneeId), status: s.status })),
    })),
    templateSteps.map((s, i) => stageLabel(i, s.name)),
    crewNames,
  );
  const isDemo = [...list.people.values()].some((p) => p.isPlaceholder);

  return (
    <div className="space-y-6">
      <AsOf today={list.today} asOf={asOf} />
      {isDemo ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <strong className="font-semibold">Demo data.</strong> Your 17 units with their real statuses, scope and notes,
          but made-up dates and placeholder people (Inspector A, Crew A…), plus three Oakwood examples showing a block,
          an N/A skip and a send-back, and six months of made-up finished turns for the reports.
        </p>
      ) : null}
      <SheetCheckPanel check={checkSheetSnapshot()} />
      <SummaryCards summary={summary} dueSoonDays={list.settings.dueSoonDays} />
      <TrackerTable rows={list.rows} columns={columns} people={list.people} />
    </div>
  );
}

function AsOf({ today, asOf }: { today: string; asOf?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Calculate as of</span>
        <input
          type="date"
          name="asOf"
          defaultValue={today}
          className="h-10 rounded-md border border-border bg-card px-3 text-foreground"
        />
      </label>
      <button type="submit" className="h-10 rounded-md bg-primary px-4 font-medium text-primary-foreground">
        Recalculate
      </button>
      {asOf ? (
        <Link href="/tracker" className="h-10 content-center text-primary underline-offset-4 hover:underline">
          Back to today
        </Link>
      ) : (
        <span className="h-10 content-center text-muted-foreground">Pick a future date to watch days and flags change.</span>
      )}
    </form>
  );
}

function SheetCheckPanel({ check }: { check: SheetCheck }) {
  const matching = check.rows.filter((r) => r.matches).length;
  const allMatch = matching === check.rows.length && check.summaryMatches;
  return (
    <section
      aria-labelledby="sheet-check"
      className={cn(
        "rounded-lg border px-4 py-3",
        allMatch ? "border-st-done-fg/30 bg-st-done-bg text-st-done-fg" : "border-st-blocked-fg/30 bg-st-blocked-bg text-st-blocked-fg",
      )}
    >
      <h2 id="sheet-check" className="font-semibold">
        {allMatch ? "✓ Matches your sheet" : "✗ Doesn't match your sheet"}
      </h2>
      <p className="mt-1 text-sm">
        Your real sheet ({check.rows.length} rows, exported {check.exportedOn}) run through the app&apos;s formulas:{" "}
        {matching} of {check.rows.length} rows give the same Current stage, Days vacant, Days in stage and Flag as the
        sheet showed, and the Summary tab&apos;s numbers {check.summaryMatches ? "match" : "don't match"}.
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium">Row by row</summary>
        <div className="mt-2 overflow-x-auto rounded-md bg-card text-foreground">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">Sheet stage</th>
                <th className="px-3 py-2 font-medium">App stage</th>
                <th className="px-3 py-2 font-medium">Sheet flag</th>
                <th className="px-3 py-2 font-medium">App flag</th>
                <th className="px-3 py-2 font-medium">Same?</th>
              </tr>
            </thead>
            <tbody>
              {check.rows.map((r) => (
                <tr key={r.rowNumber} className="border-t border-border">
                  <td className="px-3 py-1.5 tabular-nums">{r.rowNumber}</td>
                  <td className="px-3 py-1.5">{r.label}</td>
                  <td className="px-3 py-1.5">{r.sheet.currentStage}</td>
                  <td className="px-3 py-1.5">{r.app.currentStage}</td>
                  <td className="px-3 py-1.5">{r.sheet.flag}</td>
                  <td className="px-3 py-1.5">{r.app.flag}</td>
                  <td className="px-3 py-1.5">{r.matches ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function SummaryCards({ summary, dueSoonDays }: { summary: Summary; dueSoonDays: number }) {
  const alert = (n: number, tone: "danger" | "warning") =>
    n > 0 ? (tone === "danger" ? "font-semibold text-danger" : "font-semibold text-warning") : "";
  const headline: Array<[string, string, string]> = [
    ["Active turns (not yet complete)", String(summary.activeTurns), ""],
    ["Overdue (past target ready date)", String(summary.overdue), alert(summary.overdue, "danger")],
    [`Due within ${dueSoonDays} days`, String(summary.dueSoon), alert(summary.dueSoon, "warning")],
    ["Blocked", String(summary.blocked), alert(summary.blocked, "danger")],
    ["Completed turns (all time)", String(summary.completedAllTime), ""],
    ["Avg days vacant: active units", formatAverage(summary.avgDaysVacantActive), ""],
    ["Avg days to complete: finished turns", formatAverage(summary.avgDaysToComplete), ""],
    ["Rows missing a move-out date", String(summary.missingMoveOut), alert(summary.missingMoveOut, "danger")],
  ];
  return (
    <section aria-label="Summary" className="grid gap-4 lg:grid-cols-3">
      <Card title="Headline">
        <table className="w-full text-sm">
          <tbody>
            {headline.map(([label, value, tone]) => (
              <tr key={label} className="border-t border-border first:border-t-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
                  {label}
                </th>
                <td className={cn("py-1.5 text-right tabular-nums", tone)}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Pipeline by stage">
        <PipelineTable summary={summary} />
      </Card>
      <Card title="In-house crew workload">
        <CrewTable summary={summary} />
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

const GROUPS: Record<string, string> = {
  inspection: "Step 1: Inspection",
  scope: "Step 2: What's required",
  work: "Step 3: In-house work (our employees)",
  cleaning: "Step 4: Cleaning",
  photos: "Step 5: Photos",
  leasing: "Step 6: Upload to leasing",
};

function scopeText(step: StepState | undefined): string {
  if (!step) return "";
  return step.checklist
    .filter((c) => c.state !== "dropped")
    .map((c) => (c.state === "to_confirm" ? `${c.text} (to confirm)` : c.text))
    .join("; ");
}

function TrackerTable({
  rows,
  columns,
  people,
}: {
  rows: TurnoverView[];
  columns: Array<{ key: string; name: string }>;
  people: Map<string, PersonSummary>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="font-medium">No turnovers yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Import your sheet with <code className="rounded bg-muted px-1">npm run db:import</code>, or reload the demo
          data with <code className="rounded bg-muted px-1">npm run db:reset</code>.
        </p>
      </div>
    );
  }

  const th = "border-b border-border px-2 py-2 text-left align-bottom text-xs font-medium whitespace-nowrap";
  const td = "border-b border-border px-2 py-1.5 align-top whitespace-nowrap";
  return (
    <section
      aria-label="Unit turns"
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <table className="min-w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-[11px] tracking-wide text-muted-foreground uppercase">
            <th colSpan={4} className={cn(th, "bg-card")}>
              Unit
            </th>
            <th colSpan={4} className={cn(th, "bg-muted")}>
              Auto-calculated
            </th>
            {columns.map((c) => (
              <th key={c.key} colSpan={c.key === "scope" || c.key === "work" ? 3 : 2} className={cn(th, "border-l")}>
                {GROUPS[c.key] ?? c.name}
              </th>
            ))}
            <th className={cn(th, "border-l")}>Notes</th>
          </tr>
          <tr>
            <th scope="col" className={cn(th, "sticky left-0 z-20 w-28 min-w-28 max-w-28 bg-card")}>
              Property
            </th>
            <th scope="col" className={cn(th, "sticky left-28 z-20 min-w-16 border-r bg-card")}>
              Unit
            </th>
            <th scope="col" className={th}>
              Move-out date
            </th>
            <th scope="col" className={th}>
              Target ready date
            </th>
            <th scope="col" className={cn(th, "bg-muted")}>
              Current stage
            </th>
            <th scope="col" className={cn(th, "bg-muted text-right")}>
              Days vacant
            </th>
            <th scope="col" className={cn(th, "bg-muted text-right")}>
              Days in stage
            </th>
            <th scope="col" className={cn(th, "bg-muted")}>
              Flag
            </th>
            {columns.map((c) => (
              <StepHeaders key={c.key} column={c} th={th} />
            ))}
            <th scope="col" className={cn(th, "border-l")}>
              Notes / blockers
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { turnover: t, derived } = row;
            const unitTone =
              derived.flag === "Overdue" ? "font-semibold text-danger" : derived.isComplete ? "text-st-todo-fg" : "";
            const blockers = t.steps
              .filter((s) => s.status === "blocked")
              .map((s) => `Blocked at ${s.name}: ${s.blockedReason ?? ""}`);
            return (
              <tr key={t.id} className="hover:bg-muted/50">
                <td className={cn(td, "sticky left-0 z-10 w-28 min-w-28 max-w-28 truncate bg-card", unitTone)}>{row.propertyName}</td>
                <td className={cn(td, "sticky left-28 z-10 min-w-16 border-r border-r-border bg-card", unitTone)}>{t.unit}</td>
                <td className={cn(td, "tabular-nums")}>{formatDate(t.moveOutDate)}</td>
                <td className={cn(td, "tabular-nums")}>{formatDate(t.targetReadyDate)}</td>
                <td className={cn(td, "bg-muted/60", derived.isComplete && "text-st-todo-fg")}>{derived.currentStage}</td>
                <td className={cn(td, "bg-muted/60 text-right tabular-nums")}>{formatDays(derived.daysVacant)}</td>
                <td className={cn(td, "bg-muted/60 text-right tabular-nums")}>{formatDays(derived.daysInStage)}</td>
                <td className={cn(td, "bg-muted/60")}>
                  <FlagPill flag={derived.flag} pastTarget={row.pastTarget} />
                </td>
                {columns.map((c) => (
                  <StepCells key={c.key} step={t.steps.find((s) => s.key === c.key)} column={c} td={td} people={people} />
                ))}
                <td className={cn(td, "max-w-[28rem] border-l border-l-border whitespace-normal")}>
                  {blockers.map((b) => (
                    <p key={b} className="font-medium text-st-blocked-fg">
                      {b}
                    </p>
                  ))}
                  {t.notes ? <p>{t.notes}</p> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function StepHeaders({ column, th }: { column: { key: string; name: string }; th: string }) {
  const label = column.key === "scope" ? "Scope" : column.key === "work" ? "Work" : column.name;
  return (
    <>
      <th scope="col" className={cn(th, "border-l")}>
        {label} status
      </th>
      <th scope="col" className={th}>
        {label} date
      </th>
      {column.key === "scope" ? (
        <th scope="col" className={th}>
          Scope of work (what&apos;s required)
        </th>
      ) : null}
      {column.key === "work" ? (
        <th scope="col" className={th}>
          Assigned to (employee)
        </th>
      ) : null}
    </>
  );
}

function StepCells({
  step,
  column,
  td,
  people,
}: {
  step: StepState | undefined;
  column: { key: string };
  td: string;
  people: Map<string, PersonSummary>;
}) {
  return (
    <>
      <td className={cn(td, "border-l border-l-border", step && STATUS_STYLES[step.status])}>
        {step ? (
          <>
            {STATUS_LABELS[step.status]}
            {step.status === "scheduled" && step.scheduledOn ? (
              <span className="block text-[11px] font-normal">{formatBooking(step.scheduledOn, step.scheduledTime)}</span>
            ) : null}
          </>
        ) : (
          <StatusPill status="na" />
        )}
      </td>
      <td className={cn(td, "tabular-nums")}>{formatDate(step?.completedOn ?? null)}</td>
      {column.key === "scope" ? <td className={cn(td, "max-w-[22rem] whitespace-normal")}>{scopeText(step)}</td> : null}
      {column.key === "work" ? (
        <td className={td}>{step?.assigneeId ? (people.get(step.assigneeId)?.name ?? "") : ""}</td>
      ) : null}
    </>
  );
}
