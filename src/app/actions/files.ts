"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "@/domain/workflow/errors";
import { getDb } from "@/server/db";
import { addLink, removeAttachment } from "@/server/files/attachments";
import { fileUser } from "@/server/files/user";

export interface FileActionState {
  ok?: boolean;
  error?: string;
  at?: number;
}

const as = z.enum(["manager", "task"]);

export async function removeAttachmentAction(id: string, who: "manager" | "task"): Promise<FileActionState> {
  const user = await fileUser(as.parse(who));
  if (!user) return { error: "Sign in again." };
  if (!z.uuid().safeParse(id).success) return { error: "That's already gone." };
  try {
    await removeAttachment(await getDb(), user, id);
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message, at: Date.now() };
    throw error;
  }
  refresh();
  return { ok: true, at: Date.now() };
}

export async function addLinkAction(_previous: FileActionState, form: FormData): Promise<FileActionState> {
  const parsed = z
    .object({ turnoverId: z.uuid(), stepId: z.uuid(), url: z.string().max(1000), caption: z.string().max(120).optional(), as })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Paste the whole link, starting with https://", at: Date.now() };
  const user = await fileUser(parsed.data.as);
  if (!user) return { error: "Sign in again." };
  try {
    await addLink(await getDb(), user, parsed.data);
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message, at: Date.now() };
    throw error;
  }
  refresh();
  return { ok: true, at: Date.now() };
}
