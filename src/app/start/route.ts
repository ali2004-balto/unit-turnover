import { NextResponse } from "next/server";
import { getCurrentSession, getTaskUser } from "@/server/auth/current";

/**
 * Where the home-screen icon opens: the dashboard for a signed-in manager,
 * the task list for anyone signed in with a link, otherwise the page for
 * asking for a link (which also leads managers to their sign-in).
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  const to = session?.person.roles.includes("admin") ? "/" : (await getTaskUser()) ? "/tasks" : "/signin";
  return NextResponse.redirect(new URL(to, request.url));
}
