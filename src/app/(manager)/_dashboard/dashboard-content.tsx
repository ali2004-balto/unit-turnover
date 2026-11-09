import Link from "next/link";
import { connection } from "next/server";
import { CrewTable, PipelineTable } from "@/components/summary-tables";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import { WorkflowError } from "@/domain/workflow/errors";
import { cn } from "@/lib/utils";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { buildDashboard, parseFilters } from "@/server/queries/dashboard";
import { listTurnovers } from "@/server/queries/turnovers";
import { loadTemplate } from "@/server/workflow";
import { AutoRefresh } from "@/components/auto-refresh";
import { BoardView } from "./board-view";
import { Filters } from "./filters";
import { KpiTiles } from "./kpi-tiles";
import { ListView } from "./list-view";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function DashboardContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await requireManager("/");
  await connection();
  const db = await getDb();
  const [list, steps] = await Promise.all([
    listTurnovers(db),
    loadTemplate(db).then(
      (t) => t.steps,
      (error: unknown) => {
        if (error instanceof WorkflowError && error.code === "NOT_FOUND") return DEFAULT_TEMPLATE_STEPS;
        throw error;
      },
    ),
  ]);
  const filters = parseFilters(params);
  const dashboard = buildDashboard(list, steps, filters);
  const view = params.view === "list" ? "list" : "board";
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && k !== "view" && k !== "created" ? [[k, v]] : [])),
  ).toString();
  const filtered = Object.values(filters).some(Boolean);

  const created = typeof params.created === "string" ? Number(params.created) : 0;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={15} />
      {created > 0 ? (
        <p role="status" className="rounded-lg border border-st-done-fg/30 bg-st-done-bg px-4 py-2.5 text-sm text-st-done-fg">
          Created {created} turnover{created === 1 ? "" : "s"}. Each first step&apos;s person has been notified.
        </p>
      ) : null}
      <KpiTiles summary={dashboard.summary} dueSoonDays={dashboard.dueSoonDays} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Filters options={dashboard.options} current={filters} view={view} />
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {dashboard.cards.length} {dashboard.cards.length === 1 ? "unit" : "units"}
            {filtered ? " match" : ""}
          </p>
          <div role="group" aria-label="View" className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(["board", "list"] as const).map((v) => (
              <Link
                key={v}
                href={`/?${new URLSearchParams([...new URLSearchParams(query), ["view", v]]).toString()}`}
                aria-current={view === v ? "page" : undefined}
                className={cn(
                  "rounded px-3 py-1.5 text-sm capitalize",
                  view === v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {dashboard.totalCards === 0 ? (
        <EmptyState title="No turnovers yet">
          <Link href="/turnovers/new" className="font-medium text-primary hover:underline">
            Create your first turnover
          </Link>{" "}
          or paste a list of units.
        </EmptyState>
      ) : dashboard.cards.length === 0 ? (
        <EmptyState title="Nothing matches these filters">
          <Link href={view === "list" ? "/?view=list" : "/"} className="font-medium text-primary hover:underline">
            Clear the filters
          </Link>
        </EmptyState>
      ) : view === "list" ? (
        <ListView cards={dashboard.cards} today={dashboard.today} />
      ) : (
        <BoardView cards={dashboard.cards} columns={dashboard.columns} showComplete={filters.showComplete || filters.stage === "complete" || filters.flag === "Complete"} today={dashboard.today} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pipeline by stage" description="Every unit that isn't complete, by its current stage." />
          <div className="px-4 py-3">
            <PipelineTable summary={dashboard.summary} />
          </div>
        </Card>
        <Card>
          <CardHeader title="In-house crew workload" />
          <div className="px-4 py-3">
            <CrewTable summary={dashboard.summary} />
          </div>
        </Card>
      </div>
    </div>
  );
}
