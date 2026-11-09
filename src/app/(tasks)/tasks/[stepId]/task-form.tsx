"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useCloseDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form";
import { type TaskState, taskCommand } from "./actions";

/** A form that sends one command about this person's own task. Double taps apply once. */
export function TaskForm({
  turnoverId,
  type,
  fields,
  className,
  children,
  showError = true,
}: {
  turnoverId: string;
  type: string;
  fields?: Record<string, string | undefined>;
  className?: string;
  children: React.ReactNode;
  showError?: boolean;
}) {
  const [state, action] = useActionState<TaskState, FormData>(taskCommand, {});
  const close = useCloseDialog();
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
  return (
    <form
      className={className}
      action={(form) => {
        form.set("requestId", crypto.randomUUID());
        return action(form);
      }}
    >
      <input type="hidden" name="turnoverId" value={turnoverId} />
      <input type="hidden" name="type" value={type} />
      {Object.entries(fields ?? {}).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {children}
      {showError && state.error ? (
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      ) : null}
    </form>
  );
}

export function TaskSubmit({ children, pendingText, disabled, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending || disabled}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}
