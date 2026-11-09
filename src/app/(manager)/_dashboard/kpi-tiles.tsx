import Link from "next/link";
import type { Summary } from "@/domain/summary";
import { formatAverage } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Tile {
  label: string;
  value: string;
  href?: string;
  tone?: "danger" | "warning";
  hint?: string;
}

/** The Summary tab's headline numbers. Tiles with a link filter the board. */
export function KpiTiles({ summary, dueSoonDays }: { summary: Summary; dueSoonDays: number }) {
  const tiles: Tile[] = [
    { label: "Active turns", value: String(summary.activeTurns), href: "/" },
    {
      label: "Overdue",
      value: String(summary.overdue),
      href: "/?flag=Overdue",
      tone: summary.overdue > 0 ? "danger" : undefined,
      hint: "Past target ready date",
    },
    {
      label: `Due within ${dueSoonDays} days`,
      value: String(summary.dueSoon),
      href: "/?flag=Due+soon",
      tone: summary.dueSoon > 0 ? "warning" : undefined,
    },
    { label: "Blocked", value: String(summary.blocked), href: "/?flag=Blocked", tone: summary.blocked > 0 ? "danger" : undefined },
    { label: "Completed (all time)", value: String(summary.completedAllTime), href: "/?stage=complete&view=list" },
    { label: "Avg days vacant", value: formatAverage(summary.avgDaysVacantActive), hint: "Active units" },
    { label: "Avg days to complete", value: formatAverage(summary.avgDaysToComplete), hint: "Finished turns" },
    {
      label: "Missing move-out date",
      value: String(summary.missingMoveOut),
      href: "/?missing=moveout&view=list",
      tone: summary.missingMoveOut > 0 ? "danger" : undefined,
    },
  ];
  return (
    <section
      aria-label="Headline numbers"
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-8"
    >
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="text-xs leading-tight text-muted-foreground">{tile.label}</span>
            <span
              className={cn(
                "mt-0.5 text-xl font-semibold tabular-nums md:mt-1 md:text-2xl",
                tile.tone === "danger" && "text-danger",
                tile.tone === "warning" && "text-warning",
              )}
            >
              {tile.value}
            </span>
            {tile.hint ? <span className="hidden text-[11px] text-muted-foreground md:block">{tile.hint}</span> : null}
          </>
        );
        const className = "flex w-32 shrink-0 snap-start flex-col rounded-lg border border-border bg-card px-3 py-2 md:w-auto md:py-2.5";
        return tile.href ? (
          <Link key={tile.label} href={tile.href} className={cn(className, "hover:border-primary/50 hover:bg-muted/40")}>
            {body}
          </Link>
        ) : (
          <div key={tile.label} className={className}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
