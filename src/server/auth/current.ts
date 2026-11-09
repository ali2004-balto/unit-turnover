/**
 * The signed-in person for the current request, read from the session
 * cookie. Every manager page and every server action calls requireManager()
 * before touching data: permissions are checked on the server, not just by
 * hiding buttons.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Actor } from "@/domain/workflow/types";
import { getDb } from "../db";
import { createSession, type CurrentSession, deleteSession, findSession, type SignedInPerson } from "./sessions";

export const SESSION_COOKIE = "ut_session";

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Checking expiry uses the current time, which only exists per request.
  await connection();
  return findSession(await getDb(), token);
}

export interface Manager {
  person: SignedInPerson;
  actor: Actor;
}

/** The signed-in manager, or a redirect to the login page. */
export async function requireManager(returnTo?: string): Promise<Manager> {
  const session = await getCurrentSession();
  if (!session) redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  if (!session.person.roles.includes("admin")) redirect("/login?denied=1");
  return { person: session.person, actor: { personId: session.person.id, roles: session.person.roles } };
}

export async function startSession(personId: string, kind: "password" | "link"): Promise<void> {
  const userAgent = (await headers()).get("user-agent");
  const { token, expiresAt } = await createSession(await getDb(), personId, kind, { userAgent });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(SESSION_COOKIE);
}

/** Only same-site paths, so a login link can't send someone to another website. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
