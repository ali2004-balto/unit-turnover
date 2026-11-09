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
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { attachments, events, inspectionFindings, turnovers } from "@/db/schema";
import { isStepActive } from "@/domain/workflow/engine";
import { WorkflowError } from "@/domain/workflow/errors";
import { loadTurnover } from "../turnover-store";
import type { FileStore, UploadTarget } from "./store";

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

export interface UploadTargetStep {
  turnoverId: string;
  stepId: string;
  findingId?: string | null;
  fullQuality?: boolean;
}

/** What's known about a file before it's stored: its name, type and size. */
interface FileFacts {
  name: string;
  type: string;
  size: number;
}

function checkFiles(files: FileFacts[]): void {
  if (files.length === 0) throw new WorkflowError("VALIDATION", "Choose a photo first.");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new WorkflowError("VALIDATION", `Add at most ${MAX_FILES_PER_UPLOAD} files at a time.`);
  for (const f of files) {
    if (!ALLOWED_TYPES[f.type]) throw new WorkflowError("VALIDATION", `${f.name || "That file"} isn't a photo or PDF.`);
    if (!(f.size <= MAX_FILE_BYTES)) throw new WorkflowError("VALIDATION", `${f.name || "That file"} is over 25 MB.`);
    if (f.size === 0) throw new WorkflowError("VALIDATION", `${f.name || "That file"} is empty.`);
  }
}

/** The step being added to, once the person is cleared to add to it (and to the finding, if any). */
async function checkTarget(ex: Executor, user: FileUser, target: UploadTargetStep) {
  const step = await requireCanAdd(ex, user, target.turnoverId, target.stepId);
  if (target.findingId) {
    const [finding] = await ex
      .select({ id: inspectionFindings.id })
      .from(inspectionFindings)
      .where(and(eq(inspectionFindings.id, target.findingId), eq(inspectionFindings.stepId, step.id)));
    if (!finding) throw new WorkflowError("NOT_FOUND", "That finding no longer exists.");
  }
  return step;
}

const storageKey = (turnoverId: string, stepId: string, id: string, ext: string) => `turnovers/${turnoverId}/${stepId}/${id}.${ext}`;

/** Saves the attachment rows for stored files, plus one timeline entry. */
async function recordFiles(
  ex: Executor,
  user: FileUser,
  target: UploadTargetStep,
  stepId: string,
  files: Array<FileFacts & { id: string; key: string }>,
  now: Date,
): Promise<string[]> {
  for (const f of files) {
    const type = ALLOWED_TYPES[f.type];
    await ex.insert(attachments).values({
      id: f.id,
      turnoverId: target.turnoverId,
      stepId,
      findingId: target.findingId ?? null,
      kind: type.kind,
      storageKey: f.key,
      fileName: f.name.slice(0, 200) || `${type.kind}.${type.ext}`,
      contentType: f.type,
      sizeBytes: f.size,
      fullQuality: target.fullQuality ?? false,
      uploadedById: user.personId,
      createdAt: now,
    });
  }
  await ex.insert(events).values({
    turnoverId: target.turnoverId,
    stepId,
    actorId: user.personId,
    type: "files_added",
    data: { count: files.length, kind: files.every((f) => ALLOWED_TYPES[f.type].kind === "photo") ? "photo" : "file" },
    at: now,
  });
  await ex.update(turnovers).set({ updatedAt: now }).where(eq(turnovers.id, target.turnoverId));
  return files.map((f) => f.id);
}

/** Uploads that come through the app (development, or a store without direct uploads). */
export async function addFiles(
  ex: Executor,
  store: FileStore,
  user: FileUser,
  target: UploadTargetStep,
  files: IncomingFile[],
  now = new Date(),
): Promise<string[]> {
  checkFiles(files.map((f) => ({ name: f.name, type: f.type, size: f.data.byteLength })));
  const step = await checkTarget(ex, user, target);

  const stored: Array<FileFacts & { id: string; key: string }> = [];
  try {
    for (const f of files) {
      const id = randomUUID();
      const key = storageKey(target.turnoverId, step.id, id, ALLOWED_TYPES[f.type].ext);
      await store.put(key, f.data, f.type);
      stored.push({ id, key, name: f.name, type: f.type, size: f.data.byteLength });
    }
    return await recordFiles(ex, user, target, step.id, stored, now);
  } catch (error) {
    // Don't leave orphaned files behind if the database write failed.
    await Promise.all(stored.map((f) => store.remove(f.key).catch(() => {})));
    throw error;
  }
}

export interface PlannedUpload {
  key: string;
  name: string;
  type: string;
  upload: UploadTarget;
}

/**
 * A direct upload, step 1: checks the files and the person, then gives one
 * upload address per file. Nothing is recorded until step 2.
 */
export async function startUploads(
  ex: Executor,
  store: FileStore,
  user: FileUser,
  target: UploadTargetStep,
  files: FileFacts[],
): Promise<PlannedUpload[]> {
  if (!store.createUpload) throw new WorkflowError("INVALID_STATE", "Uploads go through the app here.");
  checkFiles(files);
  const step = await checkTarget(ex, user, target);
  return Promise.all(
    files.map(async (f) => {
      const key = storageKey(target.turnoverId, step.id, randomUUID(), ALLOWED_TYPES[f.type].ext);
      return { key, name: f.name, type: f.type, upload: await store.createUpload!(key, f.type) };
    }),
  );
}

/**
 * A direct upload, step 2: the browser says its files arrived. Each one must
 * be an address handed out for this step, really be in storage, and be a size
 * the app accepts. Then they're recorded like any other upload.
 */
export async function finishUploads(
  ex: Executor,
  store: FileStore,
  user: FileUser,
  target: UploadTargetStep,
  files: Array<{ key: string; name: string; type: string }>,
  now = new Date(),
): Promise<string[]> {
  if (!store.stat) throw new WorkflowError("INVALID_STATE", "Uploads go through the app here.");
  if (files.length === 0 || files.length > MAX_FILES_PER_UPLOAD) throw new WorkflowError("VALIDATION", "Something about this upload is wrong.");
  const step = await checkTarget(ex, user, target);
  const pattern = new RegExp(`^turnovers/${target.turnoverId}/${step.id}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.([a-z0-9]{2,5})$`);

  const ready: Array<FileFacts & { id: string; key: string }> = [];
  for (const f of files) {
    const match = pattern.exec(f.key);
    const type = ALLOWED_TYPES[f.type];
    if (!match || !type || match[2] !== type.ext) throw new WorkflowError("VALIDATION", "Something about this upload is wrong.");
    const found = await store.stat(f.key);
    if (!found) throw new WorkflowError("VALIDATION", `${f.name || "A file"} didn't finish uploading. Try again.`);
    ready.push({ id: match[1], key: f.key, name: f.name, type: f.type, size: found.size });
  }
  checkFiles(ready);
  const already = await ex
    .select({ id: attachments.id })
    .from(attachments)
    .where(inArray(attachments.id, ready.map((f) => f.id)));
  if (already.length > 0) throw new WorkflowError("VALIDATION", "Those photos are already added.");
  return recordFiles(ex, user, target, step.id, ready, now);
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
