"use client";

import { Ban, CalendarClock, Check, CircleSlash, Play, Undo2, Unlock } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { StepStatus } from "@/domain/status";
import type { StepKind } from "@/domain/workflow/types";
import { CommandForm, SubmitButton } from "./command-form";

export function StepActions(props: {
  stepId: string;
  name: string;
  kind: StepKind;
  status: StepStatus;
  ready: boolean;
  active: boolean;
  allowNa: boolean;
  requireChecklist: boolean;
  openItems: number;
  scopeItems: number;
  scheduledOn: string | null;
  scheduledTime: string | null;
  sendBackTargets: Array<{ id: string; name: string }>;
}) {
  const { stepId, name, kind, status, ready, active } = props;
  const canStart = ready && (status === "not_started" || status === "scheduled");
  const canBook = status === "not_started" || status === "scheduled";

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {ready ? <CompleteButton {...props} /> : null}

      {canStart ? (
        <CommandForm type="start" fields={{ stepId }}>
          <SubmitButton variant="secondary" size="sm">
            <Play aria-hidden /> Start
          </SubmitButton>
        </CommandForm>
      ) : null}

      {canBook ? (
        <Dialog
          trigger={
            <>
              <CalendarClock aria-hidden /> {status === "scheduled" ? "Change booking" : "Book"}
            </>
          }
          title={`Book ${name}`}
          description={
            ready ? "Booked steps show as Scheduled." : "This step isn't ready yet. Its assignee sees the booking as upcoming and is told when it's their turn."
          }
        >
          <CommandForm type="schedule" fields={{ stepId }} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor={`on-${stepId}`}>
                <Input id={`on-${stepId}`} name="on" type="date" required defaultValue={props.scheduledOn ?? ""} />
              </Field>
              <Field label="Time (optional)" htmlFor={`time-${stepId}`}>
                <Input id={`time-${stepId}`} name="time" type="time" defaultValue={props.scheduledTime ?? ""} />
              </Field>
            </div>
            <SubmitButton className="self-end">Save booking</SubmitButton>
          </CommandForm>
        </Dialog>
      ) : null}

      {status === "scheduled" ? (
        <CommandForm type="unschedule" fields={{ stepId }}>
          <SubmitButton variant="ghost" size="sm">
            Cancel booking
          </SubmitButton>
        </CommandForm>
      ) : null}

      {status === "blocked" ? (
        <Dialog
          trigger={
            <>
              <Unlock aria-hidden /> Unblock
            </>
          }
          title={`Unblock ${name}`}
          description="The step goes back to its status before it was blocked, and its assignee is told."
        >
          <CommandForm type="unblock" fields={{ stepId }} className="flex flex-col gap-4">
            <Field label="Note (optional)" htmlFor={`unblock-${stepId}`}>
              <Textarea id={`unblock-${stepId}`} name="note" placeholder="e.g. Parts arrived" maxLength={2000} />
            </Field>
            <SubmitButton className="self-end">Unblock</SubmitButton>
          </CommandForm>
        </Dialog>
      ) : active ? (
        <Dialog
          trigger={
            <>
              <Ban aria-hidden /> Block
            </>
          }
          title={`Block ${name}`}
          description="Managers are alerted. The days keep counting while it's blocked."
        >
          <CommandForm type="block" fields={{ stepId }} className="flex flex-col gap-4">
            <Field label="What is it waiting on?" htmlFor={`block-${stepId}`} hint="Parts, access or a decision.">
              <Textarea id={`block-${stepId}`} name="reason" required maxLength={500} />
            </Field>
            <SubmitButton variant="danger" className="self-end">
              Block
            </SubmitButton>
          </CommandForm>
        </Dialog>
      ) : null}

      {active && props.sendBackTargets.length > 0 ? <SendBack {...props} /> : null}

      {props.allowNa ? (
        <Dialog
          trigger={
            <>
              <CircleSlash aria-hidden /> Mark N/A
            </>
          }
          title={`Mark ${name} N/A`}
          description={
            kind === "work"
              ? "Use this when there's nothing for the in-house crew to do. The unit moves straight on."
              : "The step is skipped. If it's someone's turn now, they're told it's no longer needed."
          }
        >
          <CommandForm type="markNa" fields={{ stepId }} className="flex flex-col gap-4">
            <Field label="Why (optional)" htmlFor={`na-${stepId}`}>
              <Textarea id={`na-${stepId}`} name="reason" maxLength={500} />
            </Field>
            <SubmitButton className="self-end">Mark N/A</SubmitButton>
          </CommandForm>
        </Dialog>
      ) : null}
    </div>
  );
}

function CompleteButton(props: Parameters<typeof StepActions>[0]) {
  const { stepId, kind, openItems, requireChecklist, scopeItems } = props;
  if (kind === "scope") {
    const label = scopeItems === 0 ? "Approve: no work needed" : `Approve scope (${scopeItems} item${scopeItems === 1 ? "" : "s"})`;
    return (
      <Dialog
        trigger={
          <>
            <Check aria-hidden /> {label}
          </>
        }
        triggerProps={{ variant: "primary", size: "sm" }}
        title="Approve the scope of work"
        description={
          scopeItems === 0
            ? "With nothing to fix, in-house work is marked N/A and the unit goes straight to the next step."
            : `The ${scopeItems} item${scopeItems === 1 ? "" : "s"} become the in-house employee's checklist, and they're told it's their turn.`
        }
      >
        <CommandForm type="complete" fields={{ stepId }} className="flex justify-end">
          <SubmitButton>Approve</SubmitButton>
        </CommandForm>
      </Dialog>
    );
  }
  if (requireChecklist && openItems > 0) {
    return (
      <Dialog
        trigger={
          <>
            <Check aria-hidden /> Mark done
          </>
        }
        triggerProps={{ variant: "primary", size: "sm" }}
        title="Mark done with items still open?"
        description={`${openItems} checklist item${openItems === 1 ? " isn't" : "s aren't"} ticked off. As a manager you can mark it done anyway; the items stay open.`}
      >
        <CommandForm type="complete" fields={{ stepId }} className="flex justify-end">
          <SubmitButton>Mark done anyway</SubmitButton>
        </CommandForm>
      </Dialog>
    );
  }
  return (
    <CommandForm type="complete" fields={{ stepId }}>
      <SubmitButton size="sm">
        <Check aria-hidden /> Mark done
      </SubmitButton>
    </CommandForm>
  );
}

function SendBack({ stepId, name, sendBackTargets }: Parameters<typeof StepActions>[0]) {
  const [to, setTo] = useState(sendBackTargets.at(-1)?.id ?? "");
  const between = sendBackTargets.findIndex((t) => t.id === to) < sendBackTargets.length - 1;
  return (
    <Dialog
      trigger={
        <>
          <Undo2 aria-hidden /> Send back
        </>
      }
      title={`Send back from ${name}`}
      description="The earlier step reopens with your reason on its checklist, its assignee is told, and this step waits until it's done again."
    >
      <CommandForm type="sendBack" fields={{ fromStepId: stepId }} className="flex flex-col gap-4">
        <Field label="Send back to" htmlFor={`to-${stepId}`}>
          <Select id={`to-${stepId}`} name="toStepId" value={to} onChange={(e) => setTo(e.target.value)}>
            {sendBackTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What needs fixing?" htmlFor={`reason-${stepId}`}>
          <Textarea id={`reason-${stepId}`} name="reason" required maxLength={500} placeholder="e.g. Scuff on the bedroom wall" />
        </Field>
        {between ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="reopenBetween" defaultChecked className="mt-0.5 size-4 accent-primary" />
            Also redo the steps in between (for example cleaning after more work)
          </label>
        ) : null}
        <SubmitButton className="self-end">Send back</SubmitButton>
      </CommandForm>
    </Dialog>
  );
}
