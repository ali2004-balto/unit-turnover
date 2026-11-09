"use client";

import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { savePropertyAction } from "../actions";
import { SaveButton, SettingsForm } from "../settings-form";

interface Property {
  id: string;
  name: string;
  address: string | null;
  accessNotes: string | null;
  active: boolean;
}

export function PropertyDialog({ property }: { property?: Property }) {
  return (
    <Dialog
      trigger={
        property ? (
          "Edit"
        ) : (
          <>
            <Plus aria-hidden /> Add property
          </>
        )
      }
      triggerProps={property ? { variant: "ghost", size: "sm" } : { variant: "primary", size: "md" }}
      title={property ? `Edit ${property.name}` : "Add a property"}
    >
      <SettingsForm action={savePropertyAction} className="flex flex-col gap-4">
        {property ? <input type="hidden" name="id" value={property.id} /> : null}
        <Field label="Name" htmlFor="property-name">
          <Input id="property-name" name="name" required maxLength={60} defaultValue={property?.name} />
        </Field>
        <Field label="Address" htmlFor="property-address">
          <Input id="property-address" name="address" maxLength={300} defaultValue={property?.address ?? ""} />
        </Field>
        <Field label="Access notes" htmlFor="property-access" hint="Lockbox code, where the keys are, parking. Only the person whose turn it is sees this.">
          <Textarea id="property-access" name="accessNotes" maxLength={1000} defaultValue={property?.accessNotes ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={property?.active ?? true} className="size-4 accent-primary" />
          Active (inactive properties can&apos;t get new turnovers)
        </label>
        <SaveButton className="self-end" />
      </SettingsForm>
    </Dialog>
  );
}
