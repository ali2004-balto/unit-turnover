"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { DraftStep } from "@/domain/workflow/template-rules";
import { ROLE_LABELS, ROLES, type StepKind } from "@/domain/workflow/types";
import { saveTemplateAction } from "../../actions";
import { SaveButton, SettingsForm } from "../../settings-form";

const KIND_LABELS: Record<StepKind, string> = {
  standard: "Standard",
  inspection: "Inspection",
  scope: "Scope review",
  work: "In-house work",
};

const KIND_HINTS: Record<StepKind, string> = {
  standard: "An ordinary step.",
  inspection: "Records findings by room.",
  scope: "Its items become the work checklist.",
  work: "Gets the approved scope as its checklist; skipped if the scope is empty.",
};

type EditableStep = DraftStep & { uid: string };

let added = 0;

export function TemplateEditor({ templateId, name, steps }: { templateId: string; name: string; steps: DraftStep[] }) {
  // Existing steps are identified by their key, so the server and browser render the same ids.
  const [draft, setDraft] = useState<EditableStep[]>(() => steps.map((s, i) => ({ ...s, uid: s.key ?? `step-${i}` })));
  const update = (i: number, patch: Partial<DraftStep>) => setDraft((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const next = [...d];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <SettingsForm action={saveTemplateAction} className="space-y-4">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="steps" value={JSON.stringify(draft.map(({ uid: _u, ...s }) => s))} />
      <Field label="Workflow name" htmlFor="template-name" className="max-w-md">
        <Input id="template-name" name="name" required maxLength={60} defaultValue={name} />
      </Field>

      <ol className="space-y-3">
        {draft.map((step, i) => (
          <li key={step.uid} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-muted text-sm font-semibold" aria-hidden>
                {i + 1}
              </span>
              <label className="sr-only" htmlFor={`${step.uid}-name`}>
                Step {i + 1} name
              </label>
              <Input
                id={`${step.uid}-name`}
                value={step.name}
                onChange={(e) => update(i, { name: e.target.value })}
                maxLength={40}
                className="max-w-xs flex-1 font-medium"
              />
              <div className="ml-auto flex gap-1">
                <Button variant="ghost" size="icon" aria-label={`Move ${step.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move ${step.name} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${step.name}`}
                  disabled={draft.length === 1}
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Done by" htmlFor={`${step.uid}-role`}>
                <Select id={`${step.uid}-role`} value={step.role} onChange={(e) => update(i, { role: e.target.value as DraftStep["role"] })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" htmlFor={`${step.uid}-kind`} hint={KIND_HINTS[step.kind]}>
                <Select id={`${step.uid}-kind`} value={step.kind} onChange={(e) => update(i, { kind: e.target.value as StepKind })}>
                  {(Object.keys(KIND_LABELS) as StepKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due (days after it starts)" htmlFor={`${step.uid}-due`}>
                <Input
                  id={`${step.uid}-due`}
                  type="number"
                  min={0}
                  max={365}
                  value={step.dueDays ?? ""}
                  onChange={(e) => update(i, { dueDays: numberOrNull(e.target.value) })}
                />
              </Field>
              <Field label="Alert me after (days)" htmlFor={`${step.uid}-esc`}>
                <Input
                  id={`${step.uid}-esc`}
                  type="number"
                  min={0}
                  max={365}
                  value={step.escalateAfterDays ?? ""}
                  onChange={(e) => update(i, { escalateAfterDays: numberOrNull(e.target.value) })}
                />
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {i > 0 ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={step.parallelWithPrevious}
                    onChange={(e) => update(i, { parallelWithPrevious: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  Runs alongside the step before
                </label>
              ) : null}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={step.allowNa} onChange={(e) => update(i, { allowNa: e.target.checked })} className="size-4 accent-primary" />
                Can be skipped (N/A)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={step.requireChecklist}
                  onChange={(e) => update(i, { requireChecklist: e.target.checked })}
                  className="size-4 accent-primary"
                />
                Checklist must be finished first
              </label>
            </div>

            <Field label="Checklist (one item per line)" htmlFor={`${step.uid}-list`} className="mt-3">
              <Textarea
                id={`${step.uid}-list`}
                value={step.checklist.join("\n")}
                onChange={(e) => update(i, { checklist: e.target.value.split("\n") })}
                className="min-h-20 text-sm"
                placeholder={step.kind === "work" ? "Comes from the approved scope" : "Optional"}
              />
            </Field>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            setDraft((d) => [
              ...d,
              {
                uid: `new-${++added}`,
                name: "New step",
                role: "admin",
                kind: "standard",
                parallelWithPrevious: false,
                allowNa: true,
                requireChecklist: false,
                dueDays: 2,
                escalateAfterDays: 3,
                checklist: [],
              },
            ])
          }
        >
          <Plus aria-hidden /> Add a step
        </Button>
        <SaveButton size="lg">Save workflow</SaveButton>
      </div>
    </SettingsForm>
  );
}
