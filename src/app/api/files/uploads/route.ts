import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { MAX_FILES_PER_UPLOAD, startUploads } from "@/server/files/attachments";
import { readUploadRequest, uploadError, uploadTargetFields } from "@/server/files/http";
import { getFileStore } from "@/server/files/store";

const body = uploadTargetFields.extend({
  files: z
    .array(z.object({ name: z.string().max(300), type: z.string().max(100), size: z.number().int().nonnegative() }))
    .max(MAX_FILES_PER_UPLOAD + 1),
});

/**
 * Starts an upload. Where photo storage takes uploads straight from the
 * browser (production), this checks the person may add to the step and hands
 * back one upload address per file. Otherwise it says to send the files to
 * /api/files instead.
 */
export async function POST(request: Request) {
  const store = getFileStore();
  if (!store.createUpload) return NextResponse.json({ mode: "app" });
  const read = await readUploadRequest(request, body);
  if (!read.ok) return read.response;
  const { files, ...target } = read.body;
  try {
    const uploads = await startUploads(await getDb(), store, read.user, target, files);
    return NextResponse.json({ mode: "direct", uploads });
  } catch (error) {
    return uploadError(error);
  }
}
