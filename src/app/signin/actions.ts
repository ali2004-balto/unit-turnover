"use server";

import { redirect } from "next/navigation";
import { endTaskSession } from "@/server/auth/current";
import { redeemAccessLink, requestSignInLink } from "@/server/auth/links";
import { getDb } from "@/server/db";
import { sendQueuedMessages } from "@/server/notifications/after-response";

export interface RequestState {
  sent?: boolean;
  error?: string;
}

/** Always gives the same answer, so nobody can find out who's on the team. */
export async function requestLinkAction(_previous: RequestState, form: FormData): Promise<RequestState> {
  const db = await getDb();
  const ref = String(form.get("ref") ?? "");
  const identifier = String(form.get("identifier") ?? "").trim();
  let personId: string | undefined;
  if (ref) {
    const check = await redeemAccessLink(db, ref);
    if (!check.ok && check.reason === "expired") personId = check.personId;
  }
  if (!personId && !identifier) return { error: "Enter your mobile number or email." };
  const queued = await requestSignInLink(db, personId ? { personId } : { identifier });
  // In dry-run mode the message, link included, shows in the server log and the Outbox.
  if (queued) await sendQueuedMessages();
  return { sent: true };
}

export async function signOutOfTasks(): Promise<void> {
  await endTaskSession();
  redirect("/signin?signedOut=1");
}
