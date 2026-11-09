"use client";

import { Check, MoreHorizontal } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { StepStatus } from "@/domain/status";
import type { StepKind } from "@/domain/workflow/types";
import { TaskForm, TaskSubmit } from "./task-form";

interface Props {
  turnoverId: string;
  stepId: string;
  stepName: string;
  kind: StepKind;
  status: StepStatus;
  requireChecklist: boolean;
  openItems: number;
  findingsNeedingWork: number;
  findingsTotal: number;
  scopeItems: number;
  scheduledOn: string | null;
  scheduledTime: string | null;
  sendBackTargets: Array<{ id: string; name: string }>;
}

/** The big "done" button at the bottom of the screen, within thumb's reach, and everything else under "More". */
export function ActionBar(props: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex max-w-xl gap-2">
        <div className="flex-1">
          <Complete {...props} />
        </div>
        <More {...props} />
      </div>
    </div>
  );
}

const big = "h-14 w-full text-base";

function Complete({ turnoverId, stepId, kind, requireChecklist, openItems, findingsNeedingWork, findingsTotal, scopeItems }: Props) {
  if (requireChecklist && openItems > 0) {
    return (
      <button type="button" disabled className="h-14 w-full rounded-md bg-muted text-base font-medium text-muted-foreground">
        {openItems} item{openItems === 1 ? "" : "s"} left to tick
      </button>
    );
  }
  if (kind === "inspection" || kind === "scope") {
    const n = kind === "inspection" ? findingsNeedingWork : scopeItems;
    const title = kind === "inspection" ? "Finish the inspection?" : "Approve the scope?";
    const description =
      kind === "inspection"
        ? n === 0
          ? findingsTotal === 0
            ? "You haven't added any findings. If nothing needs work, the manager confirms and the unit skips in-house work."
            : "Nothing you found needs work. The manager confirms and the unit skips in-house work."
          : n === 1
            ? "One thing needs work. It goes to the manager as the draft scope."
            : `${n} things need work. They go to the manager as the draft scope.`
        : n === 0
          ? "Nothing needs doing, so in-house work is skipped and the unit goes straight on."
          : `The ${n} item${n === 1 ? "" : "s"} become the in-house employee's checklist.`;
    return (
      <Dialog
        trigger={
          <>
            <Check aria-hidden /> {kind === "inspection" ? "Finish inspection" : "Approve scope"}
          </>
        }
        triggerProps={{ variant: "primary", size: "lg", className: big }}
        title={title}
        description={description}
      >
        <TaskForm turnoverId={turnoverId} type="complete" fields={{ stepId }}>
          <TaskSubmit size="lg" className={big}>
            {kind === "inspection" ? (n === 0 ? "Yes, nothing needs work" : "Send to the manager") : "Approve"}
          </TaskSubmit>
        </TaskForm>
      </Dialog>
    );
  }
  return (
    <TaskForm turnoverId={turnoverId} type="complete" fields={{ stepId }}>
      <TaskSubmit size="lg" className={big} pendingText="Saving…">
        <Check aria-hidden /> Mark complete
      </TaskSubmit>
    </TaskForm>
  );
}

function More({ turnoverId, stepId, stepName, status, scheduledOn, scheduledTime, sendBackTargets }: Props) {
  const canBook = status === "not_started" || status === "scheduled";
  return (
    <Dialog
      trigger={
        <>
          <MoreHorizontal aria-hidden /> More
        </>
      }
      triggerProps={{ variant: "secondary", size: "lg", className: "h-14 px-4" }}
      title={stepName}
    >
      <div className="space-y-3">
        {status === "not_started" || status === "scheduled" ? (
          <TaskForm turnoverId={turnoverId} type="start" fields={{ stepId }}>
            <TaskSubmit variant="secondary" size="lg" className="w-full">
              I&apos;ve started
            </TaskSubmit>
          </TaskForm>
        ) : null}

        {status === "blocked" ? (
          <Section title="It's not blocked any more">
            <TaskForm turnoverId={turnoverId} type="unblock" fields={{ stepId }} className="space-y-3">
              <Field label="Note (optional)" htmlFor="unblock-note">
                <Textarea id="unblock-note" name="note" maxLength={2000} placeholder="e.g. Got the key" />
              </Field>
              <TaskSubmit size="lg" className="w-full">
                Unblock
              </TaskSubmit>
            </TaskForm>
          </Section>
        ) : (
          <Section title="I'm blocked">
            <TaskForm turnoverId={turnoverId} type="block" fields={{ stepId }} className="space-y-3">
              <Field label="What are you waiting on?" htmlFor="block-reason" hint="Parts, access or a decision. Your manager is told right away.">
                <Textarea id="block-reason" name="reason" required maxLength={500} />
              </Field>
              <TaskSubmit variant="danger" size="lg" className="w-full">
                I&apos;m blocked
              </TaskSubmit>
            </TaskForm>
          </Section>
        )}

        {canBook ? (
          <Section title={status === "scheduled" ? "Change my booking" : "Book a time"}>
            <TaskForm turnoverId={turnoverId} type="schedule" fields={{ stepId }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" htmlFor="book-on">
                  <Input id="book-on" name="on" type="date" required defaultValue={scheduledOn ?? ""} className="h-12" />
                </Field>
                <Field label="Time (optional)" htmlFor="book-time">
                  <Input id="book-time" name="time" type="time" defaultValue={scheduledTime ?? ""} className="h-12" />
                </Field>
              </div>
              <TaskSubmit size="lg" className="w-full">
                Save booking
              </TaskSubmit>
            </TaskForm>
          </Section>
        ) : null}

        {sendBackTargets.length > 0 ? (
          <Section title="Send it back">
            <TaskForm turnoverId={turnoverId} type="sendBack" fields={{ fromStepId: stepId, reopenBetween: "on" }} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Found a problem? The unit goes back to fix it, and comes back to you when it&apos;s done. Add a photo of the problem first.
              </p>
              <Field label="Back to" htmlFor="back-to">
                <Select id="back-to" name="toStepId" defaultValue={sendBackTargets.at(-1)?.id} className="h-12">
                  {sendBackTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What needs fixing?" htmlFor="back-reason">
                <Textarea id="back-reason" name="reason" required maxLength={500} placeholder="e.g. Scuff on the bedroom wall" />
              </Field>
              <TaskSubmit size="lg" className="w-full">
                Send back
              </TaskSubmit>
            </TaskForm>
          </Section>
        ) : null}

        <Section title="Add a note">
          <TaskForm turnoverId={turnoverId} type="addNote" fields={{ stepId }} className="space-y-3">
            <Textarea name="text" required maxLength={2000} aria-label="Note" placeholder="Anything the team should know" />
            <TaskSubmit size="lg" className="w-full">
              Add note
            </TaskSubmit>
          </TaskForm>
        </Section>
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex h-12 cursor-pointer items-center px-4 font-medium">{title}</summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
