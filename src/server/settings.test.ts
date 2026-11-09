import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notifications, people, propertyStepDefaults, workflowTemplates } from "@/db/schema";
import { getSettings } from "@/db/settings";
import type { DraftStep } from "@/domain/workflow/template-rules";
import { createTestDb, type TestDb } from "@/test/db";
import { checkPassword } from "./auth/sessions";
import {
  duplicateTemplate,
  makeDefaultTemplate,
  normalizePhone,
  saveAppSettings,
  saveDefaults,
  saveMessageSettings,
  savePerson,
  saveProperty,
  saveTemplate,
  setManagerPassword,
} from "./settings";
import { loadTemplate } from "./workflow";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.handle.close();
});

const person = (fields: Partial<Parameters<typeof savePerson>[2]> = {}) => ({
  name: "Sam Rivera",
  email: "sam@example.com",
  phone: "604 555 0199",
  company: null,
  roles: ["cleaner" as const],
  notifyChannel: "sms" as const,
  active: true,
  ...fields,
});

describe("app settings", () => {
  it("saves the due-soon window, default target and time zone", async () => {
    await saveAppSettings(t.db, { dueSoonDays: 5, defaultTargetDays: null, timezone: "America/Edmonton" });
    expect(await getSettings(t.db)).toMatchObject({ dueSoonDays: 5, defaultTargetDays: null, timezone: "America/Edmonton" });
  });

  it("refuses values that don't make sense", async () => {
    await expect(saveAppSettings(t.db, { dueSoonDays: -1, defaultTargetDays: 10, timezone: "America/Vancouver" })).rejects.toThrow(/0 to 60/);
    await expect(saveAppSettings(t.db, { dueSoonDays: 3, defaultTargetDays: 10, timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
  });
});

describe("properties", () => {
  it("adds a property at the end of the list, and won't allow a duplicate name", async () => {
    await saveProperty(t.db, { name: "Westridge", address: "12 Main St", accessNotes: "Lockbox 4471", active: true });
    await expect(saveProperty(t.db, { name: "acadian", address: null, accessNotes: null, active: true })).rejects.toThrow(/already a property called acadian/);
  });
});

describe("people", () => {
  it("normalizes phone numbers", () => {
    expect(normalizePhone("(604) 555-0199")).toBe("+16045550199");
    expect(normalizePhone("1-604-555-0199")).toBe("+16045550199");
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
    expect(normalizePhone("")).toBeNull();
    expect(() => normalizePhone("555-0199")).toThrow(/full phone number/);
  });

  it("adds a person and checks they can be reached the way they chose", async () => {
    const id = await savePerson(t.db, t.ids.admin, person());
    const [row] = await t.db.select().from(people).where(eq(people.id, id));
    expect(row).toMatchObject({ phone: "+16045550199", email: "sam@example.com", roles: ["cleaner"], isPlaceholder: false });
    await expect(savePerson(t.db, t.ids.admin, person({ email: "x@example.com", phone: "", notifyChannel: "sms" }))).rejects.toThrow(/phone number/);
    await expect(savePerson(t.db, t.ids.admin, person({ name: "Other", email: "SAM@example.com", phone: null, notifyChannel: "email" }))).rejects.toThrow(
      /Sam Rivera already has that email address/,
    );
  });

  it("never leaves the app without a manager, and won't let you lock yourself out", async () => {
    const admin = (await t.db.select().from(people).where(eq(people.id, t.ids.admin)))[0];
    const asInput = { ...person(), name: admin.name, email: null, phone: null, notifyChannel: "none" as const, roles: ["admin" as const] };
    await expect(savePerson(t.db, t.ids.admin, { ...asInput, id: t.ids.admin, active: false })).rejects.toThrow(/your own manager access/);
    const other = await savePerson(t.db, t.ids.admin, { ...asInput, name: "Second Manager" });
    await expect(savePerson(t.db, other, { ...asInput, id: t.ids.admin, roles: ["leasing"] })).resolves.toBe(t.ids.admin);
    await expect(savePerson(t.db, t.ids.admin, { ...asInput, id: other, name: "Second Manager", roles: ["leasing"] })).rejects.toThrow(
      /at least one active manager/,
    );
  });

  it("sets a manager's password, which they can then sign in with", async () => {
    await t.db.update(people).set({ email: "boss@example.com" }).where(eq(people.id, t.ids.admin));
    await expect(setManagerPassword(t.db, t.ids.admin, "short")).rejects.toThrow(/at least 10/);
    await expect(setManagerPassword(t.db, t.ids.crew, "a long password")).rejects.toThrow(/Only managers/);
    await setManagerPassword(t.db, t.ids.admin, "a long password");
    expect(await checkPassword(t.db, "boss@example.com", "a long password")).toMatchObject({ ok: true });
  });
});

describe("default assignees", () => {
  it("sets and clears who does each step at a property", async () => {
    const arbor = t.propertyIds.get("Arbor")!;
    await saveDefaults(t.db, arbor, { inspection: t.ids.inspector, work: t.ids.crew2 });
    await saveDefaults(t.db, arbor, { inspection: null });
    const rows = await t.db.select().from(propertyStepDefaults).where(eq(propertyStepDefaults.propertyId, arbor));
    expect(rows.map((r) => [r.stepKey, r.personId])).toEqual([["work", t.ids.crew2]]);
  });
});

describe("workflow templates", () => {
  it("saves edited steps without touching turnovers already under way", async () => {
    const { steps } = await loadTemplate(t.db);
    const draft: DraftStep[] = steps.map(({ position: _p, ...s }) => s);
    draft.splice(4, 0, { ...draft[3], key: undefined, name: "Touch-up after cleaning", kind: "standard", checklist: [] });
    draft[4].parallelWithPrevious = true;
    await saveTemplate(t.db, t.templateId, "Standard turnover", draft);
    const saved = await loadTemplate(t.db);
    expect(saved.steps.map((s) => [s.position, s.key, s.parallelWithPrevious])).toEqual([
      [1, "inspection", false],
      [2, "scope", false],
      [3, "work", false],
      [4, "cleaning", false],
      [5, "touch-up-after-cleaning", true],
      [6, "photos", false],
      [7, "leasing", false],
    ]);
  });

  it("refuses a broken workflow with the reasons", async () => {
    await expect(saveTemplate(t.db, t.templateId, "Standard", [])).rejects.toThrow(/at least one step/);
  });

  it("copies a workflow and can make the copy the default", async () => {
    const copy = await duplicateTemplate(t.db, t.templateId);
    await makeDefaultTemplate(t.db, copy);
    const rows = await t.db.select().from(workflowTemplates);
    expect(rows.find((r) => r.id === copy)).toMatchObject({ name: "Copy of Standard turnover", isDefault: true });
    expect(rows.find((r) => r.id === t.templateId)).toMatchObject({ isDefault: false });
    expect((await loadTemplate(t.db, copy)).steps).toHaveLength(6);
  });
});

describe("message timings", () => {
  it("saves quiet hours and the morning time, and re-checks texts held for the old hours", async () => {
    const later = new Date(Date.now() + 3_600_000);
    const [held] = await t.db.insert(notifications).values({ recipientId: t.ids.crew, kind: "step_assigned", sendAfter: later }).returning();
    await saveMessageSettings(t.db, { quietHoursStart: "21:30", quietHoursEnd: "06:45", digestTime: "06:30" });
    expect(await getSettings(t.db)).toMatchObject({ quietHoursStart: "21:30", quietHoursEnd: "06:45", digestTime: "06:30" });
    const [after] = await t.db.select().from(notifications).where(eq(notifications.id, held.id));
    expect(after.sendAfter.getTime()).toBeLessThan(later.getTime());
  });

  it("only takes clock times", async () => {
    await expect(saveMessageSettings(t.db, { quietHoursStart: "8pm", quietHoursEnd: "07:00", digestTime: "07:00" })).rejects.toThrow(
      "Use a time like 07:00 for the quiet hours start.",
    );
    await expect(saveMessageSettings(t.db, { quietHoursStart: "20:00", quietHoursEnd: "07:00", digestTime: "24:00" })).rejects.toThrow(/morning messages/);
  });
});
