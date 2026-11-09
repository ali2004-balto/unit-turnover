import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkflowError } from "@/domain/workflow/errors";
import { getDb } from "@/server/db";
import { addFiles, MAX_FILES_PER_UPLOAD } from "@/server/files/attachments";
import { getFileStore } from "@/server/files/store";
import { fileUser } from "@/server/files/user";

const fields = z.object({
  turnoverId: z.uuid(),
  stepId: z.uuid(),
  findingId: z.uuid().optional(),
  fullQuality: z.enum(["0", "1"]).optional(),
  as: z.enum(["manager", "task"]).default("task"),
});

/** Uploads photos or PDFs to a step. Permission is checked against the database, not the page that sent them. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload didn't arrive in one piece. Try again." }, { status: 400 });
  }
  const parsed = fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return NextResponse.json({ error: "Something about this upload is wrong." }, { status: 400 });
  const user = await fileUser(parsed.data.as);
  if (!user) return NextResponse.json({ error: "Sign in again to add photos." }, { status: 401 });

  const files = form.getAll("file").filter((f): f is File => typeof f !== "string").slice(0, MAX_FILES_PER_UPLOAD + 1);
  try {
    const incoming = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) })));
    const ids = await addFiles(await getDb(), getFileStore(), user, { ...parsed.data, fullQuality: parsed.data.fullQuality === "1" }, incoming);
    return NextResponse.json({ ids });
  } catch (error) {
    if (error instanceof WorkflowError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
