import { cn } from "@/lib/utils";
import type { CardView } from "@/server/queries/dashboard";
import { UnitCard } from "./unit-card";

export function BoardView({
  cards,
  columns,
  showComplete,
}: {
  cards: CardView[];
  columns: Array<{ key: string; label: string }>;
  showComplete: boolean;
  today: string;
}) {
  const all = showComplete ? [...columns, { key: "complete", label: "Complete" }] : columns;
  return (
    <section aria-label="Board" className="md:-mx-6 md:overflow-x-auto md:px-6 md:pb-2">
      <div className="flex flex-col gap-3 md:min-w-max md:flex-row xl:min-w-0">
        {all.map((column) => {
          const inColumn = cards.filter((c) => c.columnKey === column.key);
          return (
            <div
              key={column.key}
              className={cn(
                "flex-col rounded-lg bg-muted/60 p-2 md:flex md:w-72 md:shrink-0 xl:w-auto xl:min-w-52 xl:flex-1",
                // On phones, stages stack and empty ones are left out.
                inColumn.length === 0 ? "hidden" : "flex",
              )}
            >
              <h2 className="flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-semibold">
                {column.label}
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {inColumn.length}
                </span>
              </h2>
              <div className="flex flex-col gap-2">
                {inColumn.length === 0 ? (
                  <p className="px-1.5 py-6 text-center text-xs text-muted-foreground">No units here</p>
                ) : (
                  inColumn.map((card) => <UnitCard key={card.id} card={card} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
