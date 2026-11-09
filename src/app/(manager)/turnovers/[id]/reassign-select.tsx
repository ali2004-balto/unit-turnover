"use client";

import { Select } from "@/components/ui/form";
import { CommandForm } from "./command-form";

export function ReassignSelect({
  stepId,
  assigneeId,
  candidates,
  others,
  disabled,
}: {
  stepId: string;
  assigneeId: string | null;
  candidates: Array<{ id: string; name: string }>;
  others: Array<{ id: string; name: string }>;
  disabled?: boolean;
}) {
  return (
    <CommandForm type="reassign" fields={{ stepId }} checkVersion={false}>
      <label className="sr-only" htmlFor={`assignee-${stepId}`}>
        Assigned to
      </label>
      <Select
        id={`assignee-${stepId}`}
        name="assigneeId"
        defaultValue={assigneeId ?? ""}
        disabled={disabled}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9"
      >
        <option value="">Nobody assigned</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {others.length > 0 ? (
          <optgroup label="Other people">
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </CommandForm>
  );
}
