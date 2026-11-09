"use server";

import { refresh } from "next/cache";
import { WorkflowError } from "@/domain/workflow/errors";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { commandFromForm } from "@/server/forms/command-form";
import { runCommand } from "@/server/workflow";

export interface CommandState {
  ok?: boolean;
  error?: string;
  /** Changes on every result, so forms can react to a repeat of the same outcome. */
  at?: number;
}

/** Every button on the turnover page posts here. The manager check and the engine's rules run on the server. */
export async function turnoverCommand(_previous: CommandState, form: FormData): Promise<CommandState> {
  const { actor } = await requireManager();
  const parsed = commandFromForm(form);
  if (!parsed.ok) return { error: parsed.error, at: Date.now() };
  try {
    await runCommand(await getDb(), parsed.turnoverId, parsed.command, {
      actor,
      expectedVersion: parsed.version,
      requestId: parsed.requestId,
    });
  } catch (error) {
    if (error instanceof WorkflowError) {
      if (error.code === "CONFLICT") refresh();
      return { error: error.message, at: Date.now() };
    }
    throw error;
  }
  refresh();
  return { ok: true, at: Date.now() };
}
