import type { Summary } from "@/domain/summary";
import { formatAverage } from "@/lib/format";

/** The Summary tab's "Pipeline by stage" table. */
export function PipelineTable({ summary }: { summary: Summary }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="pb-1 text-left font-medium">Stage</th>
          <th className="pb-1 text-right font-medium">Units now</th>
          <th className="pb-1 text-right font-medium">Avg days in stage</th>
          <th className="pb-1 text-right font-medium">Longest</th>
        </tr>
      </thead>
      <tbody>
        {summary.pipeline.map((p) => (
          <tr key={p.stage} className="border-t border-border">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              {p.stage}
            </th>
            <td className="py-1.5 text-right tabular-nums">{p.unitsNow}</td>
            <td className="py-1.5 text-right tabular-nums">{formatAverage(p.avgDaysInStage)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatAverage(p.longestInStage)}</td>
          </tr>
        ))}
        <tr className="border-t border-border font-medium">
          <th scope="row" className="py-1.5 text-left">
            Total active
          </th>
          <td className="py-1.5 text-right tabular-nums">{summary.totalActive}</td>
          <td colSpan={2} />
        </tr>
      </tbody>
    </table>
  );
}

/** The Summary tab's "In-house crew workload" table. */
export function CrewTable({ summary }: { summary: Summary }) {
  return (
    <>
      {summary.crew.length === 0 ? (
        <p className="text-sm text-muted-foreground">No in-house employees yet. Add them in Settings → People.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="pb-1 text-left font-medium">Employee</th>
              <th className="pb-1 text-right font-medium">Open jobs</th>
              <th className="pb-1 text-right font-medium">In progress</th>
              <th className="pb-1 text-right font-medium">Completed (all time)</th>
            </tr>
          </thead>
          <tbody>
            {summary.crew.map((c) => (
              <tr key={c.name} className="border-t border-border">
                <th scope="row" className="py-1.5 text-left font-normal">
                  {c.name}
                </th>
                <td className="py-1.5 text-right tabular-nums">{c.openJobs}</td>
                <td className="py-1.5 text-right tabular-nums">{c.inProgress}</td>
                <td className="py-1.5 text-right tabular-nums">{c.completedAllTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Open jobs = assigned to the employee and the in-house work step is not Done or N/A.
      </p>
    </>
  );
}
