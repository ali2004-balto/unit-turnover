"use client";

import { RotateCw, Sunrise } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { SaveButton, SettingsForm } from "../settings-form";
import { type OutboxActionState, retryMessageAction, runMorningNowAction, saveMessageSettingsAction } from "./actions";

export function MessageSettingsForm({ quietHoursStart, quietHoursEnd, digestTime }: { quietHoursStart: string; quietHoursEnd: string; digestTime: string }) {
  return (
    <SettingsForm action={saveMessageSettingsAction} className="space-y-4 rounded-lg border border-border bg-card p-5">
      <fieldset>
        <legend className="text-sm font-medium">No texts between</legend>
        <div className="mt-1.5 flex items-center gap-2">
          <Input aria-label="Quiet hours start" name="quietHoursStart" type="time" required defaultValue={quietHoursStart} className="w-32" />
          <span className="text-sm text-muted-foreground">and</span>
          <Input aria-label="Quiet hours end" name="quietHoursEnd" type="time" required defaultValue={quietHoursEnd} className="w-32" />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Texts wait until the morning; emails still go. Set both to the same time to allow texts at any hour.
        </p>
      </fieldset>
      <Field
        label="Morning messages at"
        htmlFor="digestTime"
        hint="Reminders for the day, and the managers' morning summary. If this is inside quiet hours, they go when quiet hours end."
      >
        <Input id="digestTime" name="digestTime" type="time" required defaultValue={digestTime} className="w-32" />
      </Field>
      <SaveButton />
    </SettingsForm>
  );
}

function Submit({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function RunMorningButton() {
  const [state, action] = useActionState<OutboxActionState>(runMorningNowAction, {});
  return (
    <form action={action} className="space-y-2">
      <Submit pendingText="Checking…">
        <Sunrise className="size-4" aria-hidden /> Send this morning&apos;s messages now
      </Submit>
      {state.note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.note}
        </p>
      ) : null}
      <FormError message={state.error} />
    </form>
  );
}

export function RetryButton({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState<OutboxActionState, FormData>(retryMessageAction, {});
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <Submit pendingText="Sending…">
        <RotateCw className="size-3.5" aria-hidden /> {label}
      </Submit>
      <FormError message={state.error} />
    </form>
  );
}
