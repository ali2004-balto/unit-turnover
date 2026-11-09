"use client";

import { Camera, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { cn } from "@/lib/utils";

const BATCH = 5;

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
      for (let i = 0; i < files.length; i += BATCH) {
        const form = new FormData();
        form.set("turnoverId", turnoverId);
        form.set("stepId", stepId);
        if (findingId) form.set("findingId", findingId);
        form.set("as", as);
        form.set("fullQuality", fullQuality ? "1" : "0");
        for (const f of files.slice(i, i + BATCH)) form.append("file", f);
        setMessage(files.length === 1 ? "Uploading…" : `Uploading ${Math.min(i + BATCH, files.length)} of ${files.length}…`);
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "The upload didn't go through. Check your connection and try again.");
        }
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
