import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkflowError } from "@/domain/workflow/errors";
import type { FileUser } from "./attachments";
import { fileUser } from "./user";

/** Which turnover and step an upload is for, as the browser sends it. */
export const uploadTargetFields = z.object({
  turnoverId: z.uuid(),
  stepId: z.uuid(),
  findingId: z.uuid().optional(),
  fullQuality: z.boolean().optional(),
  as: z.enum(["manager", "task"]).default("task"),
});

/**
 * Reads a JSON upload request and who's sending it. Permission to add to the
 * step is checked later, against the database.
 */
export async function readUploadRequest<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; body: z.infer<T>; user: FileUser } | { ok: false; response: NextResponse }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return { ok: false, response: NextResponse.json({ error: "Something about this upload is wrong." }, { status: 400 }) };
  const user = await fileUser((parsed.data as { as: "manager" | "task" }).as);
  if (!user) return { ok: false, response: NextResponse.json({ error: "Sign in again to add photos." }, { status: 401 }) };
  return { ok: true, body: parsed.data, user };
}

/** A rule the upload broke, as a response the uploader can show. Anything else is a real error. */
export function uploadError(error: unknown): NextResponse {
  if (error instanceof WorkflowError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  throw error;
}
