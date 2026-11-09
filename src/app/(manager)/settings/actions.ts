"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type DraftStep } from "@/domain/workflow/template-rules";
import { ROLES, STEP_KINDS } from "@/domain/workflow/types";
import { requireManager } from "@/server/auth/current";
import { revokeLinksFor } from "@/server/auth/links";
import { deleteSessionsFor } from "@/server/auth/sessions";
import { getDb } from "@/server/db";
import {
  duplicateTemplate,
  makeDefaultTemplate,
  saveAppSettings,
  saveDefaults,
  savePerson,
  saveProperty,
  saveTemplate,
  SettingsError,
  setManagerPassword,
} from "@/server/settings";

export interface SettingsState {
  ok?: boolean;
  error?: string;
  at?: number;
}

/** Runs a settings change for a signed-in manager and turns rule violations into messages. */
async function attempt(change: (actorId: string) => Promise<unknown>): Promise<SettingsState> {
  const { person } = await requireManager();
  try {
    await change(person.id);
  } catch (error) {
    if (error instanceof SettingsError) return { error: error.message, at: Date.now() };
    throw error;
  }
  refresh();
  return { ok: true, at: Date.now() };
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const intOrNull = (value: string) => (value === "" ? null : Number(value));
const optionalId = (form: FormData, key: string) => z.uuid().safeParse(form.get(key)).data;

export async function saveGeneralAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async () => {
    await saveAppSettings(await getDb(), {
      dueSoonDays: Number(str(form, "dueSoonDays")),
      defaultTargetDays: intOrNull(str(form, "defaultTargetDays")),
      timezone: str(form, "timezone"),
    });
  });
}

export async function savePropertyAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async () => {
    await saveProperty(await getDb(), {
      id: optionalId(form, "id"),
      name: str(form, "name"),
      address: str(form, "address") || null,
      accessNotes: str(form, "accessNotes") || null,
      active: form.get("active") === "on",
    });
  });
}

const channel = z.enum(["sms", "email", "both", "none"]);

export async function savePersonAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async (actorId) => {
    const roles = form.getAll("roles").filter((r): r is (typeof ROLES)[number] => ROLES.includes(r as never));
    const notify = channel.safeParse(form.get("notifyChannel"));
    if (!notify.success) throw new SettingsError("Choose how they hear from the app.");
    await savePerson(await getDb(), actorId, {
      id: optionalId(form, "id"),
      name: str(form, "name"),
      email: str(form, "email") || null,
      phone: str(form, "phone") || null,
      company: str(form, "company") || null,
      roles,
      notifyChannel: notify.data,
      active: form.get("active") === "on",
    });
  });
}

export async function setPasswordAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async () => {
    const personId = optionalId(form, "personId");
    if (!personId) throw new SettingsError("Pick a person.");
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) throw new SettingsError("The two passwords don't match.");
    await setManagerPassword(await getDb(), personId, password);
  });
}

export async function signOutEverywhereAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async (actorId) => {
    const personId = optionalId(form, "personId");
    if (!personId) throw new SettingsError("Pick a person.");
    if (personId === actorId) throw new SettingsError("Use the sign-out button to sign yourself out.");
    const db = await getDb();
    await deleteSessionsFor(db, personId);
    // Their sign-in links stop working too, e.g. after a lost phone.
    await revokeLinksFor(db, personId);
  });
}

export async function saveDefaultsAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async () => {
    const propertyId = optionalId(form, "propertyId");
    if (!propertyId) throw new SettingsError("Pick a property.");
    const byStep: Record<string, string | null> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string" && key.startsWith("step:")) byStep[key.slice(5)] = z.uuid().safeParse(value).data ?? null;
    }
    await saveDefaults(await getDb(), propertyId, byStep);
  });
}

const draftStep = z.object({
  key: z.string().max(40).optional(),
  name: z.string().max(60),
  role: z.enum(ROLES),
  kind: z.enum(STEP_KINDS),
  parallelWithPrevious: z.boolean(),
  allowNa: z.boolean(),
  requireChecklist: z.boolean(),
  dueDays: z.number().nullable(),
  escalateAfterDays: z.number().nullable(),
  checklist: z.array(z.string().max(300)).max(60),
});

export async function saveTemplateAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async () => {
    const templateId = optionalId(form, "templateId");
    if (!templateId) throw new SettingsError("That workflow no longer exists.");
    let steps: DraftStep[];
    try {
      steps = z.array(draftStep).max(30).parse(JSON.parse(String(form.get("steps") ?? "[]")));
    } catch {
      throw new SettingsError("Something in the steps is wrong. Reload the page and try again.");
    }
    await saveTemplate(await getDb(), templateId, str(form, "name"), steps);
  });
}

export async function duplicateTemplateAction(form: FormData): Promise<void> {
  await requireManager();
  const templateId = optionalId(form, "templateId");
  if (!templateId) return;
  const copy = await duplicateTemplate(await getDb(), templateId);
  redirect(`/settings/templates/${copy}`);
}

export async function makeDefaultTemplateAction(form: FormData): Promise<void> {
  await requireManager();
  const templateId = optionalId(form, "templateId");
  if (!templateId) return;
  await makeDefaultTemplate(await getDb(), templateId);
  refresh();
}
