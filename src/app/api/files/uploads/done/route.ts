import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { finishUploads, MAX_FILES_PER_UPLOAD } from "@/server/files/attachments";
import { readUploadRequest, uploadError, uploadTargetFields } from "@/server/files/http";
import { getFileStore } from "@/server/files/store";

const body = uploadTargetFields.extend({
  files: z
    .array(z.object({ key: z.string().max(300), name: z.string().max(300), type: z.string().max(100) }))
    .min(1)
    .max(MAX_FILES_PER_UPLOAD),
});

/** Finishes a direct upload: checks the files really arrived, then adds them to the step. */
export async function POST(request: Request) {
  const read = await readUploadRequest(request, body);
  if (!read.ok) return read.response;
  const { files, ...target } = read.body;
  try {
    const ids = await finishUploads(await getDb(), getFileStore(), read.user, target, files);
    return NextResponse.json({ ids });
  } catch (error) {
    return uploadError(error);
  }
}
