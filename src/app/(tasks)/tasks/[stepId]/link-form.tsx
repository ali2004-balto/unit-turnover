"use client";

import { useActionState } from "react";
import { addLinkAction, type FileActionState } from "@/app/actions/files";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/form";

export function LinkForm({ turnoverId, stepId, placeholder }: { turnoverId: string; stepId: string; placeholder: string }) {
  const [state, action, pending] = useActionState<FileActionState, FormData>(addLinkAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="turnoverId" value={turnoverId} />
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="as" value="task" />
      <label className="sr-only" htmlFor={`link-${stepId}`}>
        {placeholder}
      </label>
      <div className="flex gap-2">
        <Input id={`link-${stepId}`} name="url" type="url" inputMode="url" required placeholder={placeholder} className="h-12 text-base" />
        <Button type="submit" variant="secondary" size="lg" disabled={pending}>
          {pending ? "Adding…" : "Add link"}
        </Button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
