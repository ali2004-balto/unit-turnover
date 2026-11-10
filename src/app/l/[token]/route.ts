import { type NextRequest, NextResponse } from "next/server";
import { TASK_COOKIE } from "@/server/auth/current";
import { openLink } from "@/server/auth/links";
import { getDb } from "@/server/db";

/**
 * Opening a sign-in link: signs the person in to their tasks on this device
 * for a year (or keeps and renews the sign-in it already has) and opens the
 * task it was sent for.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/l/[token]">) {
  const { token } = await ctx.params;
  const opened = await openLink(await getDb(), token, {
    deviceSession: request.cookies.get(TASK_COOKIE)?.value,
    userAgent: request.headers.get("user-agent"),
  });
  if (!opened.ok) {
    const url = new URL("/signin", request.url);
    url.searchParams.set("link", opened.reason);
    // An expired link can ask for a fresh one to be sent to the phone or email on file.
    if (opened.reason === "expired") url.searchParams.set("ref", token);
    return NextResponse.redirect(url);
  }
  const response = NextResponse.redirect(new URL(opened.stepId ? `/tasks/${opened.stepId}` : "/tasks", request.url));
  response.cookies.set(TASK_COOKIE, opened.session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: opened.session.expiresAt,
  });
  // Don't let the link sit in browser history or referrer headers for long.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
