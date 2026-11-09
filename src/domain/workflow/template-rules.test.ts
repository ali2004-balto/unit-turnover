import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE_STEPS } from "./default-template";
import { checkTemplate, type DraftStep, slugify } from "./template-rules";

const draft = (): DraftStep[] => DEFAULT_TEMPLATE_STEPS.map(({ position: _p, ...s }) => ({ ...s, checklist: [...s.checklist] }));

describe("checkTemplate", () => {
  it("accepts the standard six steps unchanged", () => {
    const result = checkTemplate(draft());
    expect(result).toEqual({ ok: true, steps: DEFAULT_TEMPLATE_STEPS });
  });

  it("keeps a step's key when it's renamed, and numbers steps in order", () => {
    const steps = draft();
    steps[3].name = "Deep clean";
    const moved = [steps[0], steps[1], steps[2], steps[4], steps[3], steps[5]];
    const result = checkTemplate(moved);
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.steps.map((s) => [s.position, s.key, s.name])).toEqual([
      [1, "inspection", "Inspection"],
      [2, "scope", "Scope of work"],
      [3, "work", "In-house work"],
      [4, "photos", "Photos"],
      [5, "cleaning", "Deep clean"],
      [6, "leasing", "Leasing upload"],
    ]);
  });

  it("gives new steps a key from their name", () => {
    const steps = draft();
    steps.push({ ...steps[5], key: undefined, name: "Final walk-through!", kind: "standard" });
    const result = checkTemplate(steps);
    expect(result.ok && result.steps.at(-1)!.key).toBe("final-walk-through");
  });

  it("lets a step run alongside the one before it, but never the first", () => {
    const steps = draft();
    steps[0].parallelWithPrevious = true;
    steps[3].parallelWithPrevious = true;
    const result = checkTemplate(steps);
    expect(result.ok && result.steps.map((s) => s.parallelWithPrevious)).toEqual([false, false, false, true, false, false]);
  });

  it("explains what's wrong", () => {
    const steps = draft();
    steps[1].name = " ";
    steps[2].name = "Inspection";
    steps[4].dueDays = -1;
    steps[5].kind = "work";
    const result = checkTemplate(steps);
    expect(result).toEqual({
      ok: false,
      errors: [
        "Step 2 needs a name.",
        'Two steps are called "Inspection".',
        "Step 5's due days must be a whole number from 0 to 365, or blank.",
        "Only one step can be the work step.",
      ],
    });
    expect(checkTemplate([])).toEqual({ ok: false, errors: ["A workflow needs at least one step."] });
  });

  it("requires the work step to come after the scope step", () => {
    const steps = draft();
    const swapped = [steps[0], steps[2], steps[1], ...steps.slice(3)];
    expect(checkTemplate(swapped)).toEqual({ ok: false, errors: ["The work step has to come after the scope step."] });
  });

  it("makes safe keys", () => {
    expect(slugify("Upload to leasing")).toBe("upload-to-leasing");
    expect(slugify("!!!")).toBe("step");
  });
});
