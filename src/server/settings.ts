/**
 * Settings: the app-wide settings, properties, people, default assignees and
 * workflow templates. Every function checks its input; callers check that the
 * person is a manager.
 */
import { and, arrayContains, asc, eq, ne, sql } from "drizzle-orm";
import type { Executor } from "@/db/client";
import {
  appSettings,
  credentials,
  people,
  properties,
  propertyStepDefaults,
  workflowTemplates,
  workflowTemplateSteps,
} from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/settings";
import { checkTemplate, type DraftStep } from "@/domain/workflow/template-rules";
import { ROLES, type Role } from "@/domain/workflow/types";
import { passwordProblem } from "./auth/passwords";
import { revokeLinksFor } from "./auth/links";
import { deleteSessionsFor, setPassword } from "./auth/sessions";

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

const fail = (message: string): never => {
  throw new SettingsError(message);
};

// ── App settings ────────────────────────────────────────────────────────────

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return zone.includes("/");
  } catch {
    return false;
  }
}

export async function saveAppSettings(
  ex: Executor,
  input: { dueSoonDays: number; defaultTargetDays: number | null; timezone: string },
): Promise<void> {
  if (!Number.isInteger(input.dueSoonDays) || input.dueSoonDays < 0 || input.dueSoonDays > 60) {
    fail("The due-soon window must be a whole number of days from 0 to 60.");
  }
  if (input.defaultTargetDays !== null && (!Number.isInteger(input.defaultTargetDays) || input.defaultTargetDays < 1 || input.defaultTargetDays > 365)) {
    fail("The default target must be a whole number of days from 1 to 365, or blank.");
  }
  if (!isTimeZone(input.timezone)) fail("Pick a time zone from the list.");
  await ex
    .insert(appSettings)
    .values({ ...DEFAULT_SETTINGS, ...input })
    .onConflictDoUpdate({ target: appSettings.id, set: { ...input, updatedAt: new Date() } });
}

// ── Properties ──────────────────────────────────────────────────────────────

export interface PropertyInput {
  id?: string;
  name: string;
  address: string | null;
  accessNotes: string | null;
  active: boolean;
}

export async function saveProperty(ex: Executor, input: PropertyInput): Promise<string> {
  const name = input.name.trim();
  if (!name) fail("Enter the property's name.");
  if (name.length > 60) fail("That name is too long.");
  const [clash] = await ex
    .select({ id: properties.id })
    .from(properties)
    .where(and(sql`lower(${properties.name}) = ${name.toLowerCase()}`, input.id ? ne(properties.id, input.id) : undefined));
  if (clash) fail(`There's already a property called ${name}.`);
  const values = {
    name,
    address: input.address?.trim().slice(0, 300) || null,
    accessNotes: input.accessNotes?.trim().slice(0, 1000) || null,
    active: input.active,
  };
  if (input.id) {
    const updated = await ex.update(properties).set(values).where(eq(properties.id, input.id)).returning({ id: properties.id });
    if (updated.length === 0) fail("That property no longer exists.");
    return input.id;
  }
  const [{ max }] = await ex.select({ max: sql<number>`coalesce(max(${properties.sortOrder}), -1)` }).from(properties);
  const [created] = await ex.insert(properties).values({ ...values, sortOrder: Number(max) + 1 }).returning({ id: properties.id });
  return created.id;
}

// ── People ──────────────────────────────────────────────────────────────────

/** Phone numbers are stored as +16045550123. North American numbers can be typed without the +1. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return fail("Use a full phone number, e.g. 604 555 0123 or +44 20 7946 0000.");
}

export interface PersonInput {
  id?: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  roles: Role[];
  notifyChannel: "sms" | "email" | "both" | "none";
  active: boolean;
}

async function activeManagerCount(ex: Executor, excluding: string): Promise<number> {
  const rows = await ex
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.active, true), arrayContains(people.roles, ["admin"]), ne(people.id, excluding)));
  return rows.length;
}

export async function savePerson(ex: Executor, actorId: string, input: PersonInput): Promise<string> {
  const name = input.name.trim();
  if (!name) fail("Enter their name.");
  if (name.length > 80) fail("That name is too long.");
  const roles = [...new Set(input.roles)].filter((r) => ROLES.includes(r));
  if (roles.length === 0) fail("Pick at least one role.");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("That email address doesn't look right.");
  const phone = normalizePhone(input.phone ?? "");
  if (input.notifyChannel === "sms" && !phone) fail("Add a phone number to send them texts, or choose email.");
  if (input.notifyChannel === "email" && !email) fail("Add an email address, or choose texts.");
  if (input.notifyChannel === "both" && (!phone || !email)) fail("Texts and email need both a phone number and an email address.");

  if (input.id) {
    const losesManager = !input.active || !roles.includes("admin");
    if (input.id === actorId && losesManager) fail("You can't remove your own manager access or deactivate yourself.");
    const [current] = await ex.select().from(people).where(eq(people.id, input.id));
    if (!current) fail("That person no longer exists.");
    if (losesManager && current.roles.includes("admin") && current.active && (await activeManagerCount(ex, input.id)) === 0) {
      fail("There has to be at least one active manager.");
    }
  }

  const [clash] = await ex
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(
      and(
        input.id ? ne(people.id, input.id) : undefined,
        sql`(${email !== null ? sql`lower(${people.email}) = ${email}` : sql`false`} or ${phone !== null ? sql`${people.phone} = ${phone}` : sql`false`})`,
      ),
    );
  if (clash) fail(`${clash.name} already has that ${clash.email?.toLowerCase() === email ? "email address" : "phone number"}.`);

  const values = {
    name,
    email,
    phone,
    company: input.company?.trim().slice(0, 80) || null,
    roles,
    notifyChannel: input.notifyChannel,
    active: input.active,
    isPlaceholder: false,
    updatedAt: new Date(),
  };
  if (input.id) {
    await ex.update(people).set(values).where(eq(people.id, input.id));
    if (!input.active) {
      await deleteSessionsFor(ex, input.id);
      await revokeLinksFor(ex, input.id);
    }
    return input.id;
  }
  const [created] = await ex.insert(people).values(values).returning({ id: people.id });
  return created.id;
}

export async function setManagerPassword(ex: Executor, personId: string, password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) fail(problem);
  const [person] = await ex.select().from(people).where(eq(people.id, personId));
  if (!person) fail("That person no longer exists.");
  if (!person.roles.includes("admin")) fail("Only managers sign in with a password.");
  if (!person.email) fail("Add their email address first; it's what they sign in with.");
  await setPassword(ex, personId, password);
}

export async function hasPassword(ex: Executor, personId: string): Promise<boolean> {
  const rows = await ex.select({ id: credentials.personId }).from(credentials).where(eq(credentials.personId, personId));
  return rows.length > 0;
}

// ── Default assignees ───────────────────────────────────────────────────────

/** Saves who does each step at one property. Missing or empty entries clear the default. */
export async function saveDefaults(ex: Executor, propertyId: string, byStep: Record<string, string | null>): Promise<void> {
  const ids = Object.values(byStep).filter((v): v is string => Boolean(v));
  if (ids.length > 0) {
    const found = await ex.select({ id: people.id, active: people.active }).from(people).where(sql`${people.id} in ${ids}`);
    if (found.length !== new Set(ids).size || found.some((p) => !p.active)) fail("Pick active people from the lists.");
  }
  await ex.transaction(async (tx) => {
    for (const [stepKey, personId] of Object.entries(byStep)) {
      await tx.delete(propertyStepDefaults).where(and(eq(propertyStepDefaults.propertyId, propertyId), eq(propertyStepDefaults.stepKey, stepKey)));
      if (personId) await tx.insert(propertyStepDefaults).values({ propertyId, stepKey, personId });
    }
  });
}

// ── Workflow templates ──────────────────────────────────────────────────────

export async function saveTemplate(ex: Executor, templateId: string, name: string, draft: DraftStep[]): Promise<void> {
  const title = name.trim();
  if (!title) fail("Give the workflow a name.");
  if (title.length > 60) fail("That name is too long.");
  const checked = checkTemplate(draft);
  if (!checked.ok) fail(checked.errors.join(" "));
  const steps = checked.ok ? checked.steps : [];
  await ex.transaction(async (tx) => {
    const updated = await tx
      .update(workflowTemplates)
      .set({ name: title, updatedAt: new Date() })
      .where(eq(workflowTemplates.id, templateId))
      .returning({ id: workflowTemplates.id });
    if (updated.length === 0) fail("That workflow no longer exists.");
    // Turnovers already started keep their own copy of the steps, so replacing them is safe.
    await tx.delete(workflowTemplateSteps).where(eq(workflowTemplateSteps.templateId, templateId));
    await tx.insert(workflowTemplateSteps).values(steps.map((s) => ({ ...s, templateId })));
  });
}

export async function duplicateTemplate(ex: Executor, templateId: string): Promise<string> {
  return ex.transaction(async (tx) => {
    const [source] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.id, templateId));
    if (!source) fail("That workflow no longer exists.");
    const steps = await tx.select().from(workflowTemplateSteps).where(eq(workflowTemplateSteps.templateId, templateId)).orderBy(asc(workflowTemplateSteps.position));
    const [copy] = await tx
      .insert(workflowTemplates)
      .values({ name: `Copy of ${source.name}`.slice(0, 60), description: source.description, isDefault: false })
      .returning({ id: workflowTemplates.id });
    if (steps.length > 0) {
      await tx.insert(workflowTemplateSteps).values(steps.map(({ id: _id, templateId: _t, ...s }) => ({ ...s, templateId: copy.id })));
    }
    return copy.id;
  });
}

export async function makeDefaultTemplate(ex: Executor, templateId: string): Promise<void> {
  await ex.transaction(async (tx) => {
    const [target] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.id, templateId));
    if (!target || !target.active) fail("That workflow isn't available.");
    await tx.update(workflowTemplates).set({ isDefault: false }).where(eq(workflowTemplates.isDefault, true));
    await tx.update(workflowTemplates).set({ isDefault: true, updatedAt: new Date() }).where(eq(workflowTemplates.id, templateId));
  });
}
