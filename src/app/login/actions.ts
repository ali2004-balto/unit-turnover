"use server";

import { redirect } from "next/navigation";
import { checkPassword } from "@/server/auth/sessions";
import { endSession, safeNextPath, startSession } from "@/server/auth/current";
import { getDb } from "@/server/db";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const result = await checkPassword(await getDb(), email, password);
  if (!result.ok) {
    return {
      email,
      error:
        result.reason === "locked"
          ? "Too many wrong passwords. Try again in 15 minutes."
          : "That email and password don't match.",
    };
  }
  await startSession(result.personId, "password");
  redirect(safeNextPath(form.get("next")));
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
