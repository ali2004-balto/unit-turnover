"use client";

import { Check } from "lucide-react";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useCloseDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form";
import type { SettingsState } from "./actions";

/** A settings form: shows the server's error, or a short "Saved", and closes its dialog on success. */
export function SettingsForm({
  action,
  className,
  children,
}: {
  action: (state: SettingsState, form: FormData) => Promise<SettingsState>;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  const close = useCloseDialog();
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error ? (
        <div className="mt-3">
          <FormError message={state.error} />
        </div>
      ) : null}
      {state.ok ? (
        <p role="status" className="mt-3 inline-flex items-center gap-1 text-sm text-st-done-fg">
          <Check className="size-4" aria-hidden /> Saved
        </p>
      ) : null}
    </form>
  );
}

export function SaveButton({ children = "Save", ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
