import { CalendarClock, OctagonAlert, Undo2 } from "lucide-react";
import { StatusPill } from "@/components/status";
import { isFinished } from "@/domain/status";
import { formatBooking, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type GridItem, PhotoGrid } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { SignInLinkButton } from "@/components/sign-in-link-button";
import type { StepDetail, TurnoverDetail } from "@/server/queries/turnover-detail";

function gridItems(files: TurnoverDetail["attachments"]): GridItem[] {
  return files.map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, url: a.url, caption: a.caption, canRemove: true }));
}
import { Checklist } from "./checklist";
import { ReassignSelect } from "./reassign-select";
import { StepActions } from "./step-actions";

export function StepCard({
  detail,
  people,
  turnoverId,
  findings,
  attachments,
}: {
  detail: StepDetail;
  people: TurnoverDetail["people"];
  today: string;
  turnoverId: string;
  findings: TurnoverDetail["findings"];
  attachments: TurnoverDetail["attachments"];
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
  const stepFiles = attachments.filter((a) => a.stepId === step.id && !a.findingId);

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

        {active && step.assigneeId ? (
          <SignInLinkButton
            personId={step.assigneeId}
            personName={people.find((p) => p.id === step.assigneeId)?.name ?? "them"}
            stepId={step.id}
            label={`Sign-in link for ${people.find((p) => p.id === step.assigneeId)?.name ?? "them"}`}
          />
        ) : null}

        {step.kind === "inspection" && findings.length > 0 ? (
          <div className="space-y-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Findings · {findings.length}</span>
            <ul className="space-y-2">
              {findings.map((f) => (
                <li key={f.id} className="rounded-md border border-border p-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{f.room}</p>
                  <p>
                    {f.description}{" "}
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px]", f.needsWork ? "bg-st-progress-bg text-st-progress-fg" : "bg-st-na-bg text-st-na-fg")}>
                      {f.needsWork ? "Needs work" : "Note"}
                    </span>
                  </p>
                  <PhotoGrid as="manager" items={gridItems(attachments.filter((a) => a.findingId === f.id))} />
                </li>
              ))}
            </ul>
          </div>
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

        {stepFiles.length > 0 || active ? (
          <div className="space-y-2">
            {stepFiles.length > 0 ? (
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Photos and files · {stepFiles.length}</span>
            ) : null}
            <PhotoGrid as="manager" items={gridItems(stepFiles)} />
            {active ? <PhotoUploader as="manager" turnoverId={turnoverId} stepId={step.id} size="md" fullQuality={step.key === "photos"} /> : null}
          </div>
        ) : null}

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
