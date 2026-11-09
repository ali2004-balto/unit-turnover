"use server";

import { redirect } from "next/navigation";
import { appBaseUrl, endTaskSession } from "@/server/auth/current";
import { createAccessLink, linkUrl, redeemAccessLink, requestSignInLink } from "@/server/auth/links";
import { getDb } from "@/server/db";

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
  if (queued && process.env.NODE_ENV !== "production") {
    // Development only: no texts or emails go out yet, so print the link for testing.
    const { token } = await createAccessLink(db, queued.personId, { purpose: "request" });
    console.info(`[dev] Sign-in link for ${queued.name}: ${linkUrl(await appBaseUrl(), token)}`);
  }
  return { sent: true };
}

export async function signOutOfTasks(): Promise<void> {
  await endTaskSession();
  redirect("/signin?signedOut=1");
}
