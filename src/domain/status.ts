/**
 * The six step statuses, the same values as the sheet's Status dropdowns.
 */
export const STEP_STATUSES = ["not_started", "scheduled", "in_progress", "blocked", "done", "na"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Labels shown everywhere, identical to the sheet's dropdown text. */
export const STATUS_LABELS: Record<StepStatus, string> = {
  not_started: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  na: "N/A",
};

export const STATUS_HELP: Record<StepStatus, string> = {
  not_started: "Not started",
  scheduled: "Booked, not begun",
  in_progress: "In progress",
  blocked: "Waiting on parts, access or a decision",
  done: "Done",
  na: "Step not needed",
};

/** A step counts as finished when it is Done or N/A (the sheet's rule). */
export function isFinished(status: StepStatus | null | undefined): boolean {
  return status === "done" || status === "na";
}

const BY_SHEET_LABEL = new Map<string, StepStatus>(
  STEP_STATUSES.map((s) => [STATUS_LABELS[s].toLowerCase(), s]),
);

/**
 * Reads a status as typed in the sheet. Returns null for a blank cell and
 * undefined for text that isn't one of the six statuses.
 */
export function statusFromSheet(text: string): StepStatus | null | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "") return null;
  if (t === "na" || t === "n/a" || t === "n.a.") return "na";
  return BY_SHEET_LABEL.get(t);
}
