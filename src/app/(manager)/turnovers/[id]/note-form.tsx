"use client";

import { Textarea } from "@/components/ui/form";
import { CommandForm, SubmitButton } from "./command-form";

export function NoteForm() {
  return (
    <CommandForm type="addNote" checkVersion={false} className="flex flex-col gap-2">
      <label htmlFor="timeline-note" className="sr-only">
        Add a note
      </label>
      <Textarea id="timeline-note" name="text" placeholder="Add a note for the timeline" required maxLength={2000} className="min-h-16" />
      <SubmitButton size="sm" variant="secondary" className="self-end" pendingText="Adding…">
        Add note
      </SubmitButton>
    </CommandForm>
  );
}
