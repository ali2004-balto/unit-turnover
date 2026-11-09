/**
 * The signed-in person for the current request.
 *
 * Two cookies, so one browser can hold both:
 * - ut_session: a manager's password session. Only this opens manager screens.
 * - ut_task: a sign-in link session. It opens that person's own tasks only.
 *
 * Every page and server action checks one of these on the server before
 * touching data; hiding buttons is never the only protection.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Actor } from "@/domain/workflow/types";
import { getDb } from "../db";
import { createSession, type CurrentSession, deleteSession, findSession, type SignedInPerson } from "./sessions";

export const SESSION_COOKIE = "ut_session";
export const TASK_COOKIE = "ut_task";

async function sessionFromCookie(name: string): Promise<CurrentSession | null> {
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  // Checking expiry uses the current time, which only exists per request.
  await connection();
  return findSession(await getDb(), token);
}

/** The manager (password) session, if any. */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const session = await sessionFromCookie(SESSION_COOKIE);
  return session?.kind === "password" ? session : null;
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

export interface TaskUser {
  person: SignedInPerson;
  /** Acting on their own tasks. A link never carries manager powers into the workflow. */
  actor: Actor;
  via: "link" | "password";
}

/** Whoever is doing tasks on this device: a link session first, then a manager's own session. */
export async function getTaskUser(): Promise<TaskUser | null> {
  const link = await sessionFromCookie(TASK_COOKIE);
  if (link) {
    return { person: link.person, actor: { personId: link.person.id, roles: link.person.roles.filter((r) => r !== "admin") }, via: "link" };
  }
  const manager = await getCurrentSession();
  if (manager) return { person: manager.person, actor: { personId: manager.person.id, roles: manager.person.roles }, via: "password" };
  return null;
}

export async function requireTaskUser(returnTo?: string): Promise<TaskUser> {
  const user = await getTaskUser();
  if (!user) redirect(returnTo ? `/signin?next=${encodeURIComponent(returnTo)}` : "/signin");
  return user;
}

async function setCookie(name: string, token: string, expires: Date) {
  (await cookies()).set(name, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function startSession(personId: string, kind: "password" | "link"): Promise<void> {
  const userAgent = (await headers()).get("user-agent");
  const { token, expiresAt } = await createSession(await getDb(), personId, kind, { userAgent });
  await setCookie(kind === "password" ? SESSION_COOKIE : TASK_COOKIE, token, expiresAt);
}

async function end(name: string): Promise<void> {
  const store = await cookies();
  const token = store.get(name)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(name);
}

/** Signs a manager out. */
export async function endSession(): Promise<void> {
  await end(SESSION_COOKIE);
}

/** Signs a link user out of this device. */
export async function endTaskSession(): Promise<void> {
  await end(TASK_COOKIE);
}

/** Only same-site paths, so a login link can't send someone to another website. */
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** The address people use to reach the app, for links. APP_URL wins; otherwise the current request's host. */
export async function appBaseUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
