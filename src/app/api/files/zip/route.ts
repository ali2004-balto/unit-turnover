import { zipSync } from "fflate";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { properties, turnovers } from "@/db/schema";
import { getDb } from "@/server/db";
import { canSeeTurnover, listAttachments } from "@/server/files/attachments";
import { getFileStore } from "@/server/files/store";
import { viewingUser } from "@/server/files/user";

/** All of a unit's photos (or one step's) in one zip, e.g. for leasing to upload to the listing. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const turnoverId = z.uuid().safeParse(params.get("turnoverId")).data;
  const stepId = z.uuid().safeParse(params.get("stepId")).data;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!turnoverId) return notFound();
  const user = await viewingUser();
  const db = await getDb();
  if (!user || !(await canSeeTurnover(db, user, turnoverId))) return notFound();

  const photos = (await listAttachments(db, turnoverId)).filter((a) => a.kind === "photo" && a.storageKey && (!stepId || a.stepId === stepId));
  if (photos.length === 0) return new Response("No photos yet", { status: 404 });
  const store = getFileStore();
  const entries: Record<string, Uint8Array> = {};
  for (const [i, p] of photos.entries()) {
    const file = await store.get(p.storageKey!);
    if (file) entries[`${String(i + 1).padStart(3, "0")}-${(p.fileName ?? "photo.jpg").replace(/[^\w.\-]+/g, "_")}`] = file.data;
  }
  const [row] = await db
    .select({ unit: turnovers.unit, property: properties.name })
    .from(turnovers)
    .innerJoin(properties, eq(properties.id, turnovers.propertyId))
    .where(eq(turnovers.id, turnoverId));
  const name = `${row.property}-${row.unit}-photos.zip`.replace(/[^\w.\-]+/g, "_");
  const zip = zipSync(entries, { level: 0 });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
