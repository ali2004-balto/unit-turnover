import type { Flag } from "@/domain/derived";
import { STATUS_HELP, STATUS_LABELS, type StepStatus } from "@/domain/status";
import { cn } from "@/lib/utils";

/** Background and text colour for each status, from the sheet's conditional formatting. */
export const STATUS_STYLES: Record<StepStatus, string> = {
  done: "bg-st-done-bg text-st-done-fg",
  in_progress: "bg-st-progress-bg text-st-progress-fg",
  scheduled: "bg-st-scheduled-bg text-st-scheduled-fg",
  blocked: "bg-st-blocked-bg text-st-blocked-fg font-semibold",
  na: "bg-st-na-bg text-st-na-fg",
  not_started: "bg-st-todo-bg text-st-todo-fg",
};

export const FLAG_STYLES: Record<Flag, string> = {
  Overdue: "bg-fl-overdue-bg text-fl-overdue-fg font-semibold",
  Blocked: "bg-st-blocked-bg text-st-blocked-fg font-semibold",
  "Due soon": "bg-st-progress-bg text-st-progress-fg font-semibold",
  "On track": "bg-fl-ontrack-bg text-fl-ontrack-fg",
  Complete: "bg-st-na-bg text-st-na-fg",
  "No target date": "bg-fl-notarget-bg text-fl-notarget-fg",
};

export function StatusPill({ status, className }: { status: StepStatus; className?: string }) {
  return (
    <span
      title={STATUS_HELP[status]}
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs whitespace-nowrap", STATUS_STYLES[status], className)}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function FlagPill({ flag, pastTarget, className }: { flag: Flag; pastTarget?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs whitespace-nowrap", FLAG_STYLES[flag], className)}>
      {flag}
      {pastTarget && flag !== "Overdue" ? <span className="font-normal opacity-80">· past target</span> : null}
    </span>
  );
}
