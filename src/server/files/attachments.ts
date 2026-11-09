/**
 * Photos, files and links on a turnover, with the rules for who can add,
 * see and remove them:
 *
 * - Managers: any turnover.
 * - Everyone else: only turnovers where it's currently their turn on a step,
 *   and they add to their own step. When their step is done, they no longer
 *   see the unit's photos.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { attachments, events, inspectionFindings, turnovers } from "@/db/schema";
import { isStepActive } from "@/domain/workflow/engine";
import { WorkflowError } from "@/domain/workflow/errors";
import { loadTurnover } from "../turnover-store";
import type { FileStore } from "./store";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;

export const ALLOWED_TYPES: Record<string, { ext: string; kind: "photo" | "file" }> = {
  "image/jpeg": { ext: "jpg", kind: "photo" },
  "image/png": { ext: "png", kind: "photo" },
  "image/webp": { ext: "webp", kind: "photo" },
  "image/heic": { ext: "heic", kind: "photo" },
  "image/heif": { ext: "heif", kind: "photo" },
  "application/pdf": { ext: "pdf", kind: "file" },
};

export interface FileUser {
  personId: string;
  /** Signed in with a manager password. */
  isManager: boolean;
}

export type Attachment = typeof attachments.$inferSelect;

/** May this person see this turnover's photos and files right now? */
export async function canSeeTurnover(ex: Executor, user: FileUser, turnoverId: string): Promise<boolean> {
  if (user.isManager) return true;
  const t = await loadTurnover(ex, turnoverId);
  return !!t && t.steps.some((s, i) => s.assigneeId === user.personId && isStepActive(t.steps, i));
}

/** Checks the person can add to this step: a manager, or the step's assignee while it's their turn. */
async function requireCanAdd(ex: Executor, user: FileUser, turnoverId: string, stepId: string) {
  const t = await loadTurnover(ex, turnoverId);
  const index = t?.steps.findIndex((s) => s.id === stepId) ?? -1;
  if (!t || index === -1) throw new WorkflowError("NOT_FOUND", "That task no longer exists.");
  const step = t.steps[index];
  if (!user.isManager && (step.assigneeId !== user.personId || !isStepActive(t.steps, index))) {
    throw new WorkflowError("FORBIDDEN", "You can only add photos to your own task while it's your turn.");
  }
  return step;
}

export interface IncomingFile {
  name: string;
  type: string;
  data: Uint8Array;
}

export async function addFiles(
  ex: Executor,
  store: FileStore,
  user: FileUser,
  target: { turnoverId: string; stepId: string; findingId?: string | null; fullQuality?: boolean },
  files: IncomingFile[],
  now = new Date(),
): Promise<string[]> {
  if (files.length === 0) throw new WorkflowError("VALIDATION", "Choose a photo first.");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new WorkflowError("VALIDATION", `Add at most ${MAX_FILES_PER_UPLOAD} files at a time.`);
  for (const f of files) {
    if (!ALLOWED_TYPES[f.type]) throw new WorkflowError("VALIDATION", `${f.name || "That file"} isn't a photo or PDF.`);
    if (f.data.byteLength > MAX_FILE_BYTES) throw new WorkflowError("VALIDATION", `${f.name || "That file"} is over 25 MB.`);
    if (f.data.byteLength === 0) throw new WorkflowError("VALIDATION", `${f.name || "That file"} is empty.`);
  }
  const step = await requireCanAdd(ex, user, target.turnoverId, target.stepId);
  if (target.findingId) {
    const [finding] = await ex
      .select({ id: inspectionFindings.id })
      .from(inspectionFindings)
      .where(and(eq(inspectionFindings.id, target.findingId), eq(inspectionFindings.stepId, step.id)));
    if (!finding) throw new WorkflowError("NOT_FOUND", "That finding no longer exists.");
  }

  const ids: string[] = [];
  const stored: string[] = [];
  try {
    for (const f of files) {
      const id = randomUUID();
      const type = ALLOWED_TYPES[f.type];
      const key = `turnovers/${target.turnoverId}/${step.id}/${id}.${type.ext}`;
      await store.put(key, f.data, f.type);
      stored.push(key);
      await ex.insert(attachments).values({
        id,
        turnoverId: target.turnoverId,
        stepId: step.id,
        findingId: target.findingId ?? null,
        kind: type.kind,
        storageKey: key,
        fileName: f.name.slice(0, 200) || `${type.kind}.${type.ext}`,
        contentType: f.type,
        sizeBytes: f.data.byteLength,
        fullQuality: target.fullQuality ?? false,
        uploadedById: user.personId,
        createdAt: now,
      });
      ids.push(id);
    }
  } catch (error) {
    // Don't leave orphaned files behind if the database write failed.
    await Promise.all(stored.map((k) => store.remove(k).catch(() => {})));
    throw error;
  }
  await ex.insert(events).values({
    turnoverId: target.turnoverId,
    stepId: step.id,
    actorId: user.personId,
    type: "files_added",
    data: { count: ids.length, kind: files.every((f) => ALLOWED_TYPES[f.type].kind === "photo") ? "photo" : "file" },
    at: now,
  });
  await ex.update(turnovers).set({ updatedAt: now }).where(eq(turnovers.id, target.turnoverId));
  return ids;
}

export async function addLink(
  ex: Executor,
  user: FileUser,
  target: { turnoverId: string; stepId: string; url: string; caption?: string | null },
  now = new Date(),
): Promise<string> {
  let url: URL;
  try {
    url = new URL(target.url.trim());
  } catch {
    throw new WorkflowError("VALIDATION", "Paste the whole link, starting with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new WorkflowError("VALIDATION", "Links must start with https://");
  if (url.href.length > 1000) throw new WorkflowError("VALIDATION", "That link is too long.");
  const caption = target.caption?.trim().slice(0, 120) || null;
  const step = await requireCanAdd(ex, user, target.turnoverId, target.stepId);
  const [row] = await ex
    .insert(attachments)
    .values({ turnoverId: target.turnoverId, stepId: step.id, kind: "link", url: url.href, caption, uploadedById: user.personId, createdAt: now })
    .returning({ id: attachments.id });
  await ex.insert(events).values({
    turnoverId: target.turnoverId,
    stepId: step.id,
    actorId: user.personId,
    type: "link_added",
    data: { url: url.href, caption },
    at: now,
  });
  return row.id;
}

/** The attachment, if this person may see it. */
export async function findVisibleAttachment(ex: Executor, user: FileUser, id: string): Promise<Attachment | null> {
  const [row] = await ex.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
  if (!row) return null;
  return (await canSeeTurnover(ex, user, row.turnoverId)) ? row : null;
}

export async function listAttachments(ex: Executor, turnoverId: string): Promise<Attachment[]> {
  return ex
    .select()
    .from(attachments)
    .where(and(eq(attachments.turnoverId, turnoverId), isNull(attachments.deletedAt)))
    .orderBy(asc(attachments.createdAt));
}

/** Managers can remove anything; others only what they added, while it's still their turn. */
export async function removeAttachment(ex: Executor, user: FileUser, id: string, now = new Date()): Promise<void> {
  const [row] = await ex.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
  if (!row) throw new WorkflowError("NOT_FOUND", "That's already gone.");
  if (!user.isManager) {
    if (row.uploadedById !== user.personId || !row.stepId) throw new WorkflowError("FORBIDDEN", "You can only remove what you added.");
    await requireCanAdd(ex, user, row.turnoverId, row.stepId);
  }
  await ex.update(attachments).set({ deletedAt: now }).where(eq(attachments.id, id));
  await ex.insert(events).values({
    turnoverId: row.turnoverId,
    stepId: row.stepId,
    actorId: user.personId,
    type: "file_removed",
    data: { kind: row.kind, fileName: row.fileName },
    at: now,
  });
}
