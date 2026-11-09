"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface Column {
  key: string;
  /** Under the column: "Nov" or "Nov 2". */
  label: string;
  /** null = nothing to show for this period (no column drawn). */
  value: number | null;
  /** Shown in the tooltip under the value, e.g. "5 finished". */
  detail: string;
}

const FORMATS = {
  days: (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1)),
  percent: (v: number) => `${Math.round(v * 100)}%`,
};

/** A round number at or above the largest value, for the top gridline. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

/**
 * One series over time, as columns: thin, rounded at the top, on one baseline.
 * Hover or focus a column for its numbers; the latest and the highest are labelled.
 */
export function ColumnChart({
  columns,
  values: kind,
  description,
}: {
  columns: Column[];
  /** Days (scale from the data) or a share (0 to 100%). */
  values: keyof typeof FORMATS;
  /** For screen readers: what the chart shows. */
  description: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const format = FORMATS[kind];
  // Axis labels: whole numbers stay whole ("10", "5", "0").
  const tick = (t: number) => (kind === "days" && Number.isInteger(t) ? String(t) : format(t));
  const fixedMax = kind === "percent" ? 1 : undefined;
  const values = columns.map((c) => c.value).filter((v): v is number => v !== null);
  const top = fixedMax ?? niceMax(Math.max(0, ...values));
  const ticks = [top, top / 2, 0];
  const latest = columns.findLastIndex((c) => c.value !== null);
  const highest = values.length ? columns.findIndex((c) => c.value === Math.max(...values)) : -1;
  // Only every second label when there are many columns.
  const every = columns.length > 14 ? 3 : columns.length > 8 ? 2 : 1;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{description}</figcaption>
      <div className="flex gap-2">
        {/* y-axis */}
        <div className="relative h-40 w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {tick(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-chart-axis" : "bg-border")}
                style={{ top: `${(1 - t / top) * 100}%` }}
              />
            ))}
            <ul className="absolute inset-0 flex items-end">
              {columns.map((c, i) => {
                const height = c.value === null ? 0 : Math.max(2, (c.value / top) * 100);
                const labelled = c.value !== null && (i === latest || i === highest);
                return (
                  <li
                    key={c.key}
                    tabIndex={0}
                    aria-label={`${c.label}: ${c.value === null ? "none" : format(c.value)}, ${c.detail}`}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive((a) => (a === i ? null : a))}
                    className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                  >
                    {c.value !== null ? (
                      <div
                        className={cn(
                          "w-full max-w-6 rounded-t bg-chart-accent transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-ring",
                          active !== null && active !== i && "opacity-60",
                        )}
                        style={{ height: `${height}%` }}
                      />
                    ) : null}
                    {labelled ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute text-[11px] font-medium whitespace-nowrap text-foreground"
                        style={{ bottom: `calc(${height}% + 2px)` }}
                      >
                        {format(c.value!)}
                      </span>
                    ) : null}
                    {active === i ? (
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full z-10 mb-1 min-w-28 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
                      >
                        {c.value !== null ? <p className="font-semibold text-foreground">{format(c.value)}</p> : null}
                        <p className="text-muted-foreground">{c.label}</p>
                        <p className="text-muted-foreground">{c.detail}</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          {/* x-axis */}
          <div className="mt-1 flex text-[11px] text-muted-foreground" aria-hidden>
            {columns.map((c, i) => (
              <span key={c.key} className="flex-1 truncate text-center">
                {i % every === 0 ? c.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
