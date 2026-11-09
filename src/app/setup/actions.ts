"use server";

import { redirect } from "next/navigation";
import { startSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { SettingsError } from "@/server/settings";
import { createFirstManager } from "@/server/setup";

export interface SetupState {
  error?: string;
  name?: string;
  email?: string;
}

/** Creates the first manager, signs them in, and takes them to add the team. */
export async function setupAction(_previous: SetupState, form: FormData): Promise<SetupState> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match.", name, email };
  try {
    const { personId } = await createFirstManager(
      await getDb(),
      { code: String(form.get("code") ?? ""), name, email, password },
      process.env.SETUP_TOKEN,
    );
    await startSession(personId, "password");
  } catch (error) {
    if (error instanceof SettingsError) return { error: error.message, name, email };
    throw error;
  }
  redirect("/settings/people");
}
