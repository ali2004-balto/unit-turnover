export type WorkflowErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "VALIDATION"
  | "CHECKLIST_INCOMPLETE"
  | "CONFLICT";

/** A rule was broken. The message is written to be shown to the person as-is. */
export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}
