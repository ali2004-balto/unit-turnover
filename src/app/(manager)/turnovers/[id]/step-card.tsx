import { CalendarClock, OctagonAlert, Undo2 } from "lucide-react";
import { StatusPill } from "@/components/status";
import { isFinished } from "@/domain/status";
import { formatBooking, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StepDetail, TurnoverDetail } from "@/server/queries/turnover-detail";
import { Checklist } from "./checklist";
import { ReassignSelect } from "./reassign-select";
import { StepActions } from "./step-actions";

export function StepCard({
  detail,
  people,
}: {
  detail: StepDetail;
  people: TurnoverDetail["people"];
  today: string;
}) {
  const { step, active, ready, upcomingBooking, late, bookingPassed, sendBackTargets, openItems } = detail;
  const finished = isFinished(step.status);
  const candidates = people
    .filter((p) => (p.active && p.roles.includes(step.role)) || p.id === step.assigneeId)
    .map((p) => ({ id: p.id, name: p.active ? p.name : `${p.name} (inactive)` }));
  const others = people
    .filter((p) => p.active && !p.roles.includes(step.role) && p.id !== step.assigneeId)
    .map((p) => ({ id: p.id, name: p.name }));

  const state = finished ? null : active ? "Their turn now" : upcomingBooking ? "Booked ahead" : "Waiting for earlier steps";

  return (
    <article
      aria-label={step.name}
      className={cn(
        "rounded-lg border bg-card",
        active ? "border-primary/60 shadow-sm ring-1 ring-primary/20" : "border-border",
        finished && "bg-card/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            finished ? "bg-st-done-bg text-st-done-fg" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {detail.index + 1}
        </span>
        <h2 className="font-semibold">{step.name}</h2>
        <StatusPill status={step.status} />
        {state ? <span className="text-xs text-muted-foreground">{state}</span> : null}
        <div className="ml-auto w-full sm:w-56">
          <ReassignSelect stepId={step.id} assigneeId={step.assigneeId} candidates={candidates} others={others} disabled={finished} />
        </div>
      </div>

      <div className="space-y-2 px-4 pt-2 pb-3 pl-14 text-sm">
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {finished && step.completedOn ? <span>{step.status === "na" ? "Skipped" : "Done"} {formatMonthDay(step.completedOn)}</span> : null}
          {active && step.dueOn ? (
            <span className={cn(late && "font-medium text-danger")}>
              Due {formatMonthDay(step.dueOn)}
              {late ? " (late)" : ""}
            </span>
          ) : null}
          {step.scheduledOn && !finished ? (
            <span className={cn("inline-flex items-center gap-1", bookingPassed && "font-medium text-danger")}>
              <CalendarClock className="size-3.5" aria-hidden /> Booked {formatBooking(step.scheduledOn, step.scheduledTime)}
              {bookingPassed ? " (the day has passed: did it happen?)" : ""}
            </span>
          ) : null}
          {step.reworkCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <Undo2 className="size-3.5" aria-hidden /> Sent back {step.reworkCount === 1 ? "once" : `${step.reworkCount} times`}
            </span>
          ) : null}
        </p>

        {step.status === "blocked" ? (
          <p className="flex gap-2 rounded-md bg-st-blocked-bg px-3 py-2 text-st-blocked-fg">
            <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Blocked: </span>
              {step.blockedReason}
            </span>
          </p>
        ) : null}

        <Checklist
          stepId={step.id}
          kind={step.kind}
          items={step.checklist.map((c) => ({ id: c.id, text: c.text, state: c.state, source: c.source }))}
          finished={finished}
          // Waiting steps: show what's planned, but nothing can be ticked until it's their turn.
          canTick={ready && !finished}
          collapsed={finished || !ready}
        />

        {!finished ? (
          <StepActions
            stepId={step.id}
            name={step.name}
            kind={step.kind}
            status={step.status}
            ready={ready}
            active={active}
            allowNa={step.allowNa}
            requireChecklist={step.requireChecklist}
            openItems={openItems}
            scopeItems={step.kind === "scope" ? step.checklist.filter((c) => c.state !== "dropped").length : 0}
            scheduledOn={step.scheduledOn}
            scheduledTime={step.scheduledTime}
            sendBackTargets={sendBackTargets}
          />
        ) : null}
      </div>
    </article>
  );
}
