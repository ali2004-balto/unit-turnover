import type { StepTemplate } from "./types";

/**
 * The six steps of the Master Tracker, in the sheet's order and with the
 * sheet's stage names. Managers can edit, add, remove and reorder steps in
 * Settings; this is only the starting point.
 */
export const DEFAULT_TEMPLATE_NAME = "Standard turnover";

export const DEFAULT_TEMPLATE_STEPS: StepTemplate[] = [
  {
    key: "inspection",
    name: "Inspection",
    position: 1,
    parallelWithPrevious: false,
    role: "inspector",
    kind: "inspection",
    allowNa: true,
    requireChecklist: false,
    dueDays: 2,
    escalateAfterDays: 3,
    checklist: [],
  },
  {
    key: "scope",
    name: "Scope of work",
    position: 2,
    parallelWithPrevious: false,
    role: "admin",
    kind: "scope",
    allowNa: true,
    requireChecklist: false,
    dueDays: 1,
    escalateAfterDays: 2,
    checklist: [],
  },
  {
    key: "work",
    name: "In-house work",
    position: 3,
    parallelWithPrevious: false,
    role: "crew",
    kind: "work",
    allowNa: true,
    requireChecklist: true,
    dueDays: 5,
    escalateAfterDays: 7,
    checklist: [],
  },
  {
    key: "cleaning",
    name: "Cleaning",
    position: 4,
    parallelWithPrevious: false,
    role: "cleaner",
    kind: "standard",
    allowNa: true,
    requireChecklist: false,
    dueDays: 2,
    escalateAfterDays: 3,
    checklist: ["Kitchen and appliances", "Bathroom(s)", "Floors", "Windows and tracks", "Cupboards and drawers"],
  },
  {
    key: "photos",
    name: "Photos",
    position: 5,
    parallelWithPrevious: false,
    role: "photographer",
    kind: "standard",
    allowNa: true,
    requireChecklist: false,
    dueDays: 2,
    escalateAfterDays: 3,
    checklist: ["Living room", "Kitchen", "Each bedroom", "Bathroom(s)", "Building and amenities"],
  },
  {
    key: "leasing",
    name: "Leasing upload",
    position: 6,
    parallelWithPrevious: false,
    role: "leasing",
    kind: "standard",
    allowNa: true,
    requireChecklist: false,
    dueDays: 1,
    escalateAfterDays: 2,
    checklist: ["Photos uploaded", "Listing posted"],
  },
];
