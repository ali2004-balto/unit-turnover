"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { sendQueuedMessages } from "@/server/notifications/after-response";
import { runMorning } from "@/server/notifications/morning";
import { retryNotification } from "@/server/notifications/outbox";
import { saveMessageSettings, SettingsError } from "@/server/settings";
import type { SettingsState } from "../actions";

export interface OutboxActionState extends SettingsState {
  note?: string;
}

async function attempt(change: () => Promise<string | void>): Promise<OutboxActionState> {
  await requireManager();
  try {
    const note = await change();
    refresh();
    return { ok: true, note: note || undefined, at: Date.now() };
  } catch (error) {
    if (error instanceof SettingsError) return { error: error.message, at: Date.now() };
    throw error;
  }
}

export async function saveMessageSettingsAction(_p: SettingsState, form: FormData): Promise<SettingsState> {
  return attempt(async () => {
    await saveMessageSettings(await getDb(), {
      quietHoursStart: String(form.get("quietHoursStart") ?? "").trim(),
      quietHoursEnd: String(form.get("quietHoursEnd") ?? "").trim(),
      digestTime: String(form.get("digestTime") ?? "").trim(),
    });
    await sendQueuedMessages();
  });
}

/** Sends a failed, skipped or waiting message again. */
export async function retryMessageAction(_p: OutboxActionState, form: FormData): Promise<OutboxActionState> {
  return attempt(async () => {
    const id = z.uuid().safeParse(form.get("id"));
    if (!id.success) throw new SettingsError("That message no longer exists.");
    await retryNotification(await getDb(), id.data);
    await sendQueuedMessages();
    return "Sending it again now.";
  });
}

/** Writes this morning's reminders and summary now, for trying it out. Each person still gets one a day. */
export async function runMorningNowAction(_p: OutboxActionState): Promise<OutboxActionState> {
  return attempt(async () => {
    const { queued } = await runMorning(await getDb(), new Date(), { force: true });
    await sendQueuedMessages();
    return queued === 0
      ? "Nothing new: everyone has already had today's morning messages, or there's nothing to remind anyone about."
      : `Queued ${queued} morning ${queued === 1 ? "message" : "messages"}. They're below.`;
  });
}
