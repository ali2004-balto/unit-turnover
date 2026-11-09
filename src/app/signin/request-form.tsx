"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { requestLinkAction, type RequestState } from "./actions";

export function RequestLinkForm({ notice, expiredRef }: { notice?: string; expiredRef?: string }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(requestLinkAction, {});
  if (state.sent) {
    return (
      <div role="status" className="space-y-2 text-center">
        <p className="font-medium">Check your phone or email</p>
        <p className="text-sm text-muted-foreground">
          If that belongs to someone on the team, a sign-in link is on its way. It works for 7 days.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {notice ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{notice}</p> : null}
      <FormError message={state.error} />
      {expiredRef ? (
        <>
          <input type="hidden" name="ref" value={expiredRef} />
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send me a new link"}
          </Button>
        </>
      ) : (
        <>
          <Field label="Mobile number or email" htmlFor="identifier">
            <Input id="identifier" name="identifier" autoComplete="username" inputMode="email" required className="h-12 text-base" />
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send me a sign-in link"}
          </Button>
        </>
      )}
    </form>
  );
}
