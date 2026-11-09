import { NextResponse } from "next/server";
import { createSession } from "@/server/auth/sessions";
import { TASK_COOKIE } from "@/server/auth/current";
import { redeemAccessLink } from "@/server/auth/links";
import { getDb } from "@/server/db";

/**
 * Opening a sign-in link: checks it, signs the person in to their tasks on
 * this device for 30 days, and opens the task it was sent for.
 */
export async function GET(request: Request, ctx: RouteContext<"/l/[token]">) {
  const { token } = await ctx.params;
  const db = await getDb();
  const result = await redeemAccessLink(db, token);
  if (!result.ok) {
    const url = new URL("/signin", request.url);
    url.searchParams.set("link", result.reason);
    // An expired link can ask for a fresh one to be sent to the phone or email on file.
    if (result.reason === "expired") url.searchParams.set("ref", token);
    return NextResponse.redirect(url);
  }
  const { token: sessionToken, expiresAt } = await createSession(db, result.personId, "link", {
    userAgent: request.headers.get("user-agent"),
  });
  const response = NextResponse.redirect(new URL(result.stepId ? `/tasks/${result.stepId}` : "/tasks", request.url));
  response.cookies.set(TASK_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  // Don't let the link sit in browser history or referrer headers for long.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
