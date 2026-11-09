"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { addDays, isDateOnly } from "@/domain/dates";
import { ROLE_LABELS } from "@/domain/workflow/types";
import { formatMonthDay } from "@/lib/format";
import type { NewTurnoverData } from "@/server/queries/new-turnover";
import { type CreateState, createTurnoverAction } from "./actions";

export function SingleForm({ data }: { data: NewTurnoverData }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createTurnoverAction, {});
  const [propertyId, setPropertyId] = useState(data.properties[0]?.id ?? "");
  const [moveOut, setMoveOut] = useState("");
  const defaults = data.defaults[propertyId] ?? {};
  const unitTaken = (unit: string) => data.activeUnits.includes(`${propertyId}|${unit.trim().toLowerCase()}`);
  const [unit, setUnit] = useState("");
  const defaultTarget =
    isDateOnly(moveOut) && data.defaultTargetDays !== null ? addDays(moveOut, data.defaultTargetDays) : null;

  return (
    <form action={action} className="space-y-6">
      <FormError message={state.error} />
      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
        <Field label="Property" htmlFor="propertyId">
          <Select id="propertyId" name="propertyId" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
            {data.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Unit"
          htmlFor="unit"
          error={unit && unitTaken(unit) ? "This unit already has a turnover in progress." : null}
        >
          <Input id="unit" name="unit" required maxLength={40} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 203" autoComplete="off" />
        </Field>
        <Field label="Move-out date" htmlFor="moveOutDate" hint="Leave blank if you don't know it yet.">
          <Input id="moveOutDate" name="moveOutDate" type="date" value={moveOut} onChange={(e) => setMoveOut(e.target.value)} />
        </Field>
        <Field
          label="Target ready date"
          htmlFor="targetReadyDate"
          hint={
            defaultTarget
              ? `Blank means ${formatMonthDay(defaultTarget)} (move-out + ${data.defaultTargetDays} days).`
              : "Blank means no target date."
          }
        >
          <Input id="targetReadyDate" name="targetReadyDate" type="date" min={moveOut || undefined} />
        </Field>
        {data.templates.length > 1 ? (
          <Field label="Workflow" htmlFor="templateId" className="sm:col-span-2">
            <Select id="templateId" name="templateId" defaultValue={data.templates[0].id}>
              {data.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Who does each step</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Filled in from this property&apos;s defaults (Settings → Default assignees). Change any for this unit only.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {data.steps.map((step, i) => {
            const suited = data.people.filter((p) => p.roles.includes(step.role));
            const others = data.people.filter((p) => !p.roles.includes(step.role));
            return (
              <Field key={`${propertyId}-${step.key}`} label={`${i + 1}. ${step.name}`} htmlFor={`assignee-${step.key}`} hint={ROLE_LABELS[step.role]}>
                <Select id={`assignee-${step.key}`} name={`assignee:${step.key}`} defaultValue={defaults[step.key] ?? ""}>
                  <option value="">Nobody yet</option>
                  {suited.map((p) => (
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
              </Field>
            );
          })}
        </div>
      </section>

      <Field label="Notes / blockers (optional)" htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={2000} placeholder="Anything the team should know" />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Creating…" : "Create turnover"}
        </Button>
      </div>
    </form>
  );
}
