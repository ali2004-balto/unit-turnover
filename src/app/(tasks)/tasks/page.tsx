import { CalendarClock, ChevronRight, OctagonAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusPill } from "@/components/status";
import { formatBooking, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireTaskUser } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listMyTasks, type TaskSummary } from "@/server/queries/tasks";

export const metadata: Metadata = { title: "Your tasks" };

const DONE: Record<string, string> = {
  complete: "Marked complete. Thanks! The next person has been told.",
  sentback: "Sent back. The person who needs to fix it has been told.",
};

export default function TasksPage(props: PageProps<"/tasks">) {
  return (
    <Suspense fallback={<div className="mt-2 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>}>
      <TasksContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TasksContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const user = await requireTaskUser("/tasks");
  await connection();
  const { active, upcoming, doneThisWeek } = await listMyTasks(await getDb(), user.person.id);
  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      {typeof params.done === "string" && DONE[params.done] ? (
        <p role="status" className="rounded-xl bg-st-done-bg px-4 py-3 font-medium text-st-done-fg">
          {DONE[params.done]}
        </p>
      ) : null}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {active.length === 0 ? "Nothing to do right now." : `${active.length} to do now.`}
          {doneThisWeek > 0 ? ` ${doneThisWeek} done this week.` : ""}
        </p>
      </div>

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="font-medium">You&apos;re all caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">You&apos;ll get a text when a unit is ready for you.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {active.map((t) => (
            <li key={t.stepId}>
              <TaskCard task={t} />
            </li>
          ))}
        </ul>
      )}

      {upcoming.length > 0 ? (
        <section aria-labelledby="upcoming">
          <h2 id="upcoming" className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Booked ahead
          </h2>
          <ul className="space-y-2">
            {upcoming.map((t) => (
              <li key={t.stepId}>
                <TaskCard task={t} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TaskCard({ task: t }: { task: TaskSummary }) {
  const upcoming = t.state === "upcoming";
  let tag: { text: string; tone: string } | null = null;
  if (t.status === "blocked") tag = { text: "Blocked", tone: "bg-st-blocked-bg text-st-blocked-fg" };
  else if (t.bookingPassed) tag = { text: "Booking passed", tone: "bg-fl-overdue-bg text-fl-overdue-fg" };
  else if (t.late) tag = { text: "Late", tone: "bg-fl-overdue-bg text-fl-overdue-fg" };
  else if (t.bookedToday) tag = { text: "Today", tone: "bg-st-progress-bg text-st-progress-fg" };
  else if (t.reworkCount > 0) tag = { text: "Rework", tone: "bg-st-progress-bg text-st-progress-fg" };

  return (
    <Link
      href={`/tasks/${t.stepId}`}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-card p-4 active:bg-muted",
        upcoming && "border-dashed bg-card/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold leading-tight">
            {t.propertyName} {t.unit}
          </p>
          {tag ? <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", tag.tone)}>{tag.text}</span> : null}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>{t.stepName}</span>
          {upcoming ? null : <StatusPill status={t.status} />}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          {t.scheduledOn ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden /> {upcoming ? "Booked" : "Booked"} {formatBooking(t.scheduledOn, t.scheduledTime)}
            </span>
          ) : null}
          {!upcoming && t.dueOn ? <span>Due {formatMonthDay(t.dueOn)}</span> : null}
          {!upcoming && t.totalItems > 0 ? (
            <span>
              {t.totalItems - t.openItems} of {t.totalItems} done
            </span>
          ) : null}
        </p>
        {t.blockedReason ? (
          <p className="mt-1 flex gap-1 text-sm text-st-blocked-fg">
            <OctagonAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t.blockedReason}
          </p>
        ) : null}
        {upcoming ? <p className="mt-1 text-xs text-muted-foreground">You&apos;ll get a text when it&apos;s ready for you.</p> : null}
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
