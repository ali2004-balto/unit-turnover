"use client";

import { Camera, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { cn } from "@/lib/utils";

const BATCH = 5;
const FAILED = "The upload didn't go through. Check your connection and try again.";

interface PlannedUpload {
  key: string;
  name: string;
  type: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? FAILED);
  return data;
}

/**
 * Sends a few files. In production they go straight to photo storage (the app
 * hands out an address for each, then checks they arrived); in development
 * they go through the app.
 */
async function sendBatch(target: Record<string, unknown>, files: File[]): Promise<void> {
  const start = await postJson<{ mode: "app" } | { mode: "direct"; uploads: PlannedUpload[] }>("/api/files/uploads", {
    ...target,
    files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
  });
  if (start.mode === "direct") {
    await Promise.all(
      start.uploads.map(async (u, i) => {
        const res = await fetch(u.upload.url, { method: u.upload.method, headers: u.upload.headers, body: files[i] });
        if (!res.ok) throw new Error(FAILED);
      }),
    );
    await postJson("/api/files/uploads/done", { ...target, files: start.uploads.map((u) => ({ key: u.key, name: u.name, type: u.type })) });
    return;
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(target)) {
    if (value !== undefined) form.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  for (const f of files) form.append("file", f);
  const res = await fetch("/api/files", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? FAILED);
  }
}

/** "Take photo" (opens the camera on phones) and "Choose photos". Uploads in small batches with progress. */
export function PhotoUploader({
  turnoverId,
  stepId,
  findingId,
  as = "task",
  fullQuality = false,
  size = "lg",
  className,
}: {
  turnoverId: string;
  stepId: string;
  findingId?: string;
  as?: "manager" | "task";
  fullQuality?: boolean;
  size?: "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(input: HTMLInputElement) {
    const chosen = [...(input.files ?? [])];
    input.value = "";
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setMessage(fullQuality ? "Getting ready…" : `Shrinking ${chosen.length === 1 ? "the photo" : `${chosen.length} photos`}…`);
      const files = fullQuality ? chosen : await Promise.all(chosen.map((f) => compressImage(f)));
      const target = { turnoverId, stepId, findingId, as, fullQuality };
      for (let i = 0; i < files.length; i += BATCH) {
        setMessage(files.length === 1 ? "Uploading…" : `Uploading ${Math.min(i + BATCH, files.length)} of ${files.length}…`);
        await sendBatch(target, files.slice(i, i + BATCH));
      }
      setMessage(files.length === 1 ? "Photo added" : `${files.length} photos added`);
      router.refresh();
    } catch (e) {
      setMessage(null);
      setError(e instanceof Error ? e.message : "The upload didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const button = cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card font-medium hover:bg-muted has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50 [&_svg]:size-5",
    size === "lg" ? "h-12 px-4 text-base" : "h-10 px-3 text-sm",
  );
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-camera`} className={button}>
          <Camera aria-hidden /> Take photo
          <input
            id={`${id}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(e) => upload(e.currentTarget)}
          />
        </label>
        <label htmlFor={`${id}-library`} className={button}>
          <ImagePlus aria-hidden /> {fullQuality ? "Upload photos" : "Choose photos"}
          <input
            id={`${id}-library`}
            type="file"
            accept={fullQuality ? "image/*,application/pdf" : "image/*"}
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => upload(e.currentTarget)}
          />
        </label>
      </div>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
