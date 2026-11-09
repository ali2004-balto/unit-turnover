import type { TimelineEntry } from "@/domain/workflow/describe";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<TimelineEntry["tone"], string> = {
  default: "bg-primary",
  muted: "bg-border",
  success: "bg-st-done-fg",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Timeline({ entries, timeZone }: { entries: TimelineEntry[]; timeZone: string }) {
  if (entries.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">Nothing has happened yet.</p>;
  return (
    <ol className="max-h-[48rem] overflow-y-auto px-4 py-3">
      {entries.map((e) => (
        <li key={e.key} className="relative flex gap-3 pb-4 last:pb-0">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[e.tone])} aria-hidden />
          <div className="min-w-0">
            <p className={cn("text-sm", e.tone === "muted" && "text-muted-foreground")}>{e.text}</p>
            {e.detail ? (
              <p
                className={cn(
                  "mt-0.5 text-sm break-words",
                  e.tone === "danger" ? "text-st-blocked-fg" : e.tone === "warning" ? "text-warning" : "text-muted-foreground",
                )}
              >
                {e.detail}
              </p>
            ) : null}
            <time dateTime={e.at.toISOString()} className="text-xs text-muted-foreground">
              {formatDateTime(e.at, timeZone)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
