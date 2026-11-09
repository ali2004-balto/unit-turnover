"use client";

import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { CommandForm, SubmitButton } from "./command-form";

export function EditDetails({
  moveOutDate,
  targetReadyDate,
  notes,
}: {
  moveOutDate: string | null;
  targetReadyDate: string | null;
  notes: string | null;
}) {
  return (
    <Dialog
      trigger={
        <>
          <Pencil aria-hidden /> Edit details
        </>
      }
      triggerProps={{ size: "md" }}
      title="Edit details"
      description="Changing a date recalculates days vacant, days in stage and the flag."
    >
      <CommandForm type="updateTurnover" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Move-out date" htmlFor="moveOutDate">
            <Input id="moveOutDate" name="moveOutDate" type="date" defaultValue={moveOutDate ?? ""} />
          </Field>
          <Field label="Target ready date" htmlFor="targetReadyDate" hint="Leave blank for no target.">
            <Input id="targetReadyDate" name="targetReadyDate" type="date" defaultValue={targetReadyDate ?? ""} />
          </Field>
        </div>
        <Field label="Notes / blockers" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={notes ?? ""} maxLength={2000} />
        </Field>
        <SubmitButton className="self-end">Save</SubmitButton>
      </CommandForm>
    </Dialog>
  );
}
