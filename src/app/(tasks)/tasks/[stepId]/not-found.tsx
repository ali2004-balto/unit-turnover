import Link from "next/link";

/** Shown for a task that isn't yours, isn't your turn yet, or has been finished or reassigned. */
export default function TaskNotFound() {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
      <p className="text-lg font-semibold">This task isn&apos;t available</p>
      <p className="mt-2 text-sm text-muted-foreground">
        It may be finished, given to someone else, or not ready for you yet. If you think that&apos;s wrong, ask your manager.
      </p>
      <Link href="/tasks" className="mt-6 inline-flex h-12 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground">
        See your tasks
      </Link>
    </div>
  );
}
