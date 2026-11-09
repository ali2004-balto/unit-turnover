"use client";

import { Field, Select } from "@/components/ui/form";
import { ROLE_LABELS, type Role } from "@/domain/workflow/types";
import { saveDefaultsAction } from "../actions";
import { SaveButton, SettingsForm } from "../settings-form";

export function DefaultsRow({
  property,
  steps,
  people,
  current,
}: {
  property: { id: string; name: string };
  steps: Array<{ key: string; name: string; role: Role }>;
  people: Array<{ id: string; name: string; roles: Role[] }>;
  current: Record<string, string>;
}) {
  return (
    <SettingsForm action={saveDefaultsAction} className="rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="propertyId" value={property.id} />
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{property.name}</h3>
        <SaveButton size="sm" variant="secondary" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => {
          const suited = people.filter((p) => p.roles.includes(step.role));
          const others = people.filter((p) => !p.roles.includes(step.role));
          return (
            <Field key={step.key} label={`${i + 1}. ${step.name}`} htmlFor={`${property.id}-${step.key}`} hint={ROLE_LABELS[step.role]}>
              <Select id={`${property.id}-${step.key}`} name={`step:${step.key}`} defaultValue={current[step.key] ?? ""}>
                <option value="">Nobody</option>
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
    </SettingsForm>
  );
}
