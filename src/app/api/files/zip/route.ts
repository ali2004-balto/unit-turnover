import { eq } from "drizzle-orm";
import { z } from "zod";
import { properties, turnovers } from "@/db/schema";
import { getDb } from "@/server/db";
import { canSeeTurnover, listAttachments } from "@/server/files/attachments";
import { getFileStore } from "@/server/files/store";
import { viewingUser } from "@/server/files/user";
import { zipStream } from "@/server/files/zip";

export const maxDuration = 300;

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
  const [row] = await db
    .select({ unit: turnovers.unit, property: properties.name })
    .from(turnovers)
    .innerJoin(properties, eq(properties.id, turnovers.propertyId))
    .where(eq(turnovers.id, turnoverId));
  const name = `${row.property}-${row.unit}-photos.zip`.replace(/[^\w.\-]+/g, "_");
  const files = photos.map((p, i) => ({
    name: `${String(i + 1).padStart(3, "0")}-${(p.fileName ?? "photo.jpg").replace(/[^\w.\-]+/g, "_")}`,
    key: p.storageKey!,
  }));
  return new Response(zipStream(getFileStore(), files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
