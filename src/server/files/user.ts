import "server-only";
import { getCurrentSession, getTaskUser } from "../auth/current";
import type { FileUser } from "./attachments";

/** Who's asking, for file access: a manager (password) or whoever is doing tasks on this device. */
export async function fileUser(as: "manager" | "task"): Promise<FileUser | null> {
  if (as === "manager") {
    const session = await getCurrentSession();
    return session?.person.roles.includes("admin") ? { personId: session.person.id, isManager: true } : null;
  }
  const user = await getTaskUser();
  if (!user) return null;
  return { personId: user.person.id, isManager: user.via === "password" && user.person.roles.includes("admin") };
}

/** For viewing: a manager session wins, otherwise the task user. */
export async function viewingUser(): Promise<FileUser | null> {
  return (await fileUser("manager")) ?? (await fileUser("task"));
}
