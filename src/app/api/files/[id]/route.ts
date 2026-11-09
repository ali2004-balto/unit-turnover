import { z } from "zod";
import { getDb } from "@/server/db";
import { findVisibleAttachment } from "@/server/files/attachments";
import { getFileStore } from "@/server/files/store";
import { viewingUser } from "@/server/files/user";

/** Shows a photo or file to someone allowed to see it; everyone else gets "not found". */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!z.uuid().safeParse(id).success) return notFound();
  const user = await viewingUser();
  if (!user) return notFound();
  const row = await findVisibleAttachment(await getDb(), user, id);
  if (!row?.storageKey) return notFound();
  const file = await getFileStore().get(row.storageKey);
  if (!file) return notFound();
  const download = new URL(request.url).searchParams.has("download");
  const name = (row.fileName ?? "file").replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": row.contentType ?? file.contentType,
      "Content-Length": String(file.data.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
