"use client";

import { createContext, use, useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useCloseDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { type CommandState, turnoverCommand } from "./actions";

/** Which turnover (and which version of it) the forms on this page act on. */
export const TurnoverContext = createContext<{ turnoverId: string; version: number }>({ turnoverId: "", version: 0 });

export function TurnoverProvider({ turnoverId, version, children }: { turnoverId: string; version: number; children: React.ReactNode }) {
  return <TurnoverContext value={{ turnoverId, version }}>{children}</TurnoverContext>;
}

/**
 * A form that sends one workflow command. Each submission gets its own
 * request id, so a double tap is applied once; `checkVersion` refuses the
 * change if someone else changed the unit since this page loaded.
 */
export function CommandForm({
  type,
  fields,
  checkVersion = true,
  className,
  children,
  showError = true,
}: {
  type: string;
  fields?: Record<string, string | undefined>;
  checkVersion?: boolean;
  className?: string;
  children: React.ReactNode;
  showError?: boolean;
}) {
  const { turnoverId, version } = use(TurnoverContext);
  const [state, action] = useActionState<CommandState, FormData>(turnoverCommand, {});
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
      {checkVersion ? <input type="hidden" name="version" value={version} /> : null}
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

export function SubmitButton({ children, pendingText, className, disabled, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending || disabled} className={cn(className)}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}
