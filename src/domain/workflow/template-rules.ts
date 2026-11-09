/**
 * Rules for editing a workflow template. Pure, so the editor and the server
 * apply exactly the same checks.
 */
import { ROLES, type Role, STEP_KINDS, type StepKind, type StepTemplate } from "./types";

export interface DraftStep {
  /** Existing steps keep their key even when renamed; new steps get one from their name. */
  key?: string;
  name: string;
  role: Role;
  kind: StepKind;
  parallelWithPrevious: boolean;
  allowNa: boolean;
  requireChecklist: boolean;
  dueDays: number | null;
  escalateAfterDays: number | null;
  checklist: string[];
}

export const MAX_STEPS = 20;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "step"
  );
}

export type TemplateCheck = { ok: true; steps: StepTemplate[] } | { ok: false; errors: string[] };

export function checkTemplate(draft: DraftStep[]): TemplateCheck {
  const errors: string[] = [];
  if (draft.length === 0) errors.push("A workflow needs at least one step.");
  if (draft.length > MAX_STEPS) errors.push(`A workflow can have at most ${MAX_STEPS} steps.`);

  const names = new Set<string>();
  const keys = new Set<string>();
  const steps: StepTemplate[] = [];

  draft.forEach((d, i) => {
    const label = `Step ${i + 1}`;
    const name = d.name.trim();
    if (!name) errors.push(`${label} needs a name.`);
    else if (name.length > 40) errors.push(`${label}'s name is too long.`);
    else if (names.has(name.toLowerCase())) errors.push(`Two steps are called "${name}".`);
    names.add(name.toLowerCase());

    if (!ROLES.includes(d.role)) errors.push(`${label} needs a role.`);
    if (!STEP_KINDS.includes(d.kind)) errors.push(`${label} has an unknown type.`);
    for (const [field, value] of [
      ["due days", d.dueDays],
      ["escalation days", d.escalateAfterDays],
    ] as const) {
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 365)) {
        errors.push(`${label}'s ${field} must be a whole number from 0 to 365, or blank.`);
      }
    }
    const checklist = d.checklist.map((c) => c.trim()).filter(Boolean);
    if (checklist.length > 50) errors.push(`${label} has more than 50 checklist items.`);
    if (checklist.some((c) => c.length > 300)) errors.push(`${label} has a checklist item over 300 characters.`);

    let key = d.key && /^[a-z0-9-]{1,40}$/.test(d.key) ? d.key : slugify(name);
    if (keys.has(key)) {
      let n = 2;
      while (keys.has(`${key}-${n}`)) n += 1;
      key = `${key}-${n}`;
    }
    keys.add(key);

    steps.push({
      key,
      name,
      position: i + 1,
      parallelWithPrevious: i > 0 && d.parallelWithPrevious,
      role: d.role,
      kind: d.kind,
      allowNa: d.allowNa,
      requireChecklist: d.requireChecklist,
      dueDays: d.dueDays,
      escalateAfterDays: d.escalateAfterDays,
      checklist,
    });
  });

  for (const kind of ["inspection", "scope", "work"] as const) {
    if (steps.filter((s) => s.kind === kind).length > 1) errors.push(`Only one step can be the ${kind} step.`);
  }
  const scope = steps.findIndex((s) => s.kind === "scope");
  const work = steps.findIndex((s) => s.kind === "work");
  if (scope !== -1 && work !== -1 && work < scope) errors.push("The work step has to come after the scope step.");

  return errors.length > 0 ? { ok: false, errors } : { ok: true, steps };
}
