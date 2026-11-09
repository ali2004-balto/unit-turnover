"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { ROLE_LABELS, ROLES, type Role } from "@/domain/workflow/types";
import { savePersonAction, setPasswordAction, type SettingsState, signOutEverywhereAction } from "../actions";
import { SaveButton, SettingsForm } from "../settings-form";

interface Person {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  roles: Role[];
  notifyChannel: "sms" | "email" | "both" | "none";
  active: boolean;
}

export function PersonDialog({ person }: { person?: Person }) {
  const id = person?.id ?? "new";
  return (
    <Dialog
      trigger={
        person ? (
          "Edit"
        ) : (
          <>
            <Plus aria-hidden /> Add person
          </>
        )
      }
      triggerProps={person ? { variant: "ghost", size: "sm" } : { variant: "primary", size: "md" }}
      title={person ? `Edit ${person.name}` : "Add a person"}
    >
      <SettingsForm action={savePersonAction} className="flex flex-col gap-4">
        {person ? <input type="hidden" name="id" value={person.id} /> : null}
        <Field label="Name" htmlFor={`name-${id}`}>
          <Input id={`name-${id}`} name="name" required maxLength={80} defaultValue={person?.name} />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">Roles</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="roles" value={role} defaultChecked={person?.roles.includes(role)} className="size-4 accent-primary" />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile phone" htmlFor={`phone-${id}`}>
            <Input id={`phone-${id}`} name="phone" type="tel" autoComplete="off" defaultValue={person?.phone ?? ""} placeholder="604 555 0123" />
          </Field>
          <Field label="Email" htmlFor={`email-${id}`}>
            <Input id={`email-${id}`} name="email" type="email" autoComplete="off" defaultValue={person?.email ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company (outside companies)" htmlFor={`company-${id}`}>
            <Input id={`company-${id}`} name="company" maxLength={80} defaultValue={person?.company ?? ""} />
          </Field>
          <Field label="Hears from the app by" htmlFor={`notify-${id}`}>
            <Select id={`notify-${id}`} name="notifyChannel" defaultValue={person?.notifyChannel ?? "sms"}>
              <option value="sms">Text</option>
              <option value="email">Email</option>
              <option value="both">Text and email</option>
              <option value="none">Nothing</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={person?.active ?? true} className="size-4 accent-primary" />
          Active (inactive people can&apos;t sign in or be assigned)
        </label>
        <SaveButton className="self-end" />
      </SettingsForm>
    </Dialog>
  );
}

export function PasswordDialog({ personId, name, hasPassword }: { personId: string; name: string; hasPassword: boolean }) {
  return (
    <Dialog
      trigger={hasPassword ? "Password" : "Set password"}
      triggerProps={{ variant: "ghost", size: "sm" }}
      title={`${hasPassword ? "Change" : "Set"} ${name}'s password`}
      description="At least 10 characters. A few unrelated words make a strong, memorable password."
    >
      <SettingsForm action={setPasswordAction} className="flex flex-col gap-4">
        <input type="hidden" name="personId" value={personId} />
        <Field label="New password" htmlFor={`pw-${personId}`}>
          <Input id={`pw-${personId}`} name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Type it again" htmlFor={`pw2-${personId}`}>
          <Input id={`pw2-${personId}`} name="confirm" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <SaveButton className="self-end">Save password</SaveButton>
      </SettingsForm>
    </Dialog>
  );
}

export function SignOutButton({ personId }: { personId: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(signOutEverywhereAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="personId" value={personId} />
      <button
        type="submit"
        disabled={pending}
        title="Signs them out on every device, e.g. after a lost phone"
        aria-label="Sign out on every device"
        className="h-8 rounded-md px-3 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {state.ok ? "Signed out" : pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
