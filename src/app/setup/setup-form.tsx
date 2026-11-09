"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { setupAction, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Create the first manager account. You can add everyone else from Settings afterwards.</p>
      <FormError message={state.error} />
      <Field label="Setup code" htmlFor="code" hint="The SETUP_TOKEN from the server's settings.">
        <Input id="code" name="code" type="password" autoComplete="off" required autoFocus />
      </Field>
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required defaultValue={state.name} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Password again" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Setting up…" : "Create my account"}
      </Button>
    </form>
  );
}
