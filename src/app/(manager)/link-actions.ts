"use server";

import { z } from "zod";
import { appBaseUrl, requireManager } from "@/server/auth/current";
import { createAccessLink, LINK_DAYS, linkUrl } from "@/server/auth/links";
import { getDb } from "@/server/db";

export interface LinkResult {
  url?: string;
  error?: string;
  days?: number;
}

/** A manager makes a sign-in link for someone, optionally opening a particular task. */
export async function createSignInLinkAction(personId: string, stepId?: string): Promise<LinkResult> {
  const { person } = await requireManager();
  const ids = z.object({ personId: z.uuid(), stepId: z.uuid().optional() }).safeParse({ personId, stepId });
  if (!ids.success) return { error: "Pick a person." };
  const { token } = await createAccessLink(await getDb(), ids.data.personId, {
    purpose: "manual",
    stepId: ids.data.stepId ?? null,
    createdById: person.id,
  });
  return { url: linkUrl(await appBaseUrl(), token), days: LINK_DAYS };
}
