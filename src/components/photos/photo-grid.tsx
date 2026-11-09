"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import { useTransition } from "react";
import { removeAttachmentAction } from "@/app/actions/files";

export interface GridItem {
  id: string;
  kind: "photo" | "file" | "link";
  fileName: string | null;
  url: string | null;
  caption: string | null;
  canRemove: boolean;
}

/** Thumbnails that open full size, plus files and links. */
export function PhotoGrid({ items, as = "task" }: { items: GridItem[]; as?: "manager" | "task" }) {
  const [pending, start] = useTransition();
  const photos = items.filter((i) => i.kind === "photo");
  const others = items.filter((i) => i.kind !== "photo");
  if (items.length === 0) return null;
  const remove = (id: string) =>
    start(async () => {
      if (window.confirm("Remove this?")) await removeAttachmentAction(id, as);
    });

  return (
    <div className="space-y-2" aria-busy={pending}>
      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-md bg-muted">
              <a href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${p.fileName ?? "photo"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private, permission-checked files */}
                <img src={`/api/files/${p.id}`} alt={p.fileName ?? "Photo"} loading="lazy" className="size-full object-cover" />
              </a>
              {p.canRemove ? (
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
                  aria-label="Remove photo"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <ul className="space-y-1">
          {others.map((o) => (
            <li key={o.id} className="flex items-center gap-2 text-sm">
              {o.kind === "link" ? <ExternalLink className="size-4 shrink-0" aria-hidden /> : <FileText className="size-4 shrink-0" aria-hidden />}
              <a
                href={o.kind === "link" ? o.url! : `/api/files/${o.id}`}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 truncate text-primary hover:underline"
              >
                {o.caption || o.fileName || o.url}
              </a>
              {o.canRemove ? (
                <button type="button" onClick={() => remove(o.id)} className="text-xs text-muted-foreground hover:text-danger" aria-label="Remove">
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
