/**
 * Where uploaded photos and files are kept.
 *
 * - Development: a local folder (.data/uploads).
 * - Production: Supabase Storage (src/server/files/supabase-store.ts), set up
 *   with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Browsers upload straight
 *   to it and view files through short-lived links, so big photos never pass
 *   through the app's own servers (which cap requests at a few MB on Vercel).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkflowError } from "@/domain/workflow/errors";
import { assertSafeKey } from "./keys";
import { SupabaseFileStore } from "./supabase-store";

export interface StoredFile {
  data: Uint8Array;
  contentType: string;
}

/** Where and how a browser sends one file straight to storage. */
export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface FileStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  remove(key: string): Promise<void>;
  /** Stores that take uploads straight from the browser hand out an address for each file. */
  createUpload?(key: string, contentType: string): Promise<UploadTarget>;
  /** The size of a stored file, or null when it isn't there (to check a direct upload arrived). */
  stat?(key: string): Promise<{ size: number; contentType: string | null } | null>;
  /** A short-lived address the browser can load the file from directly. */
  downloadUrl?(key: string, opts: { fileName: string; download: boolean }): Promise<string>;
}

export { assertSafeKey } from "./keys";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  private file(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string): Promise<StoredFile | null> {
    try {
      const data = await readFile(this.file(key));
      return { data, contentType: TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}

/** A server with no lasting disk (Vercel) and no storage set up: say so instead of losing files. */
class UnconfiguredStore implements FileStore {
  private refuse(): never {
    throw new WorkflowError("INVALID_STATE", "Photo storage isn't set up yet: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  async put(): Promise<void> {
    this.refuse();
  }
  async get(): Promise<StoredFile | null> {
    return null;
  }
  async remove(): Promise<void> {}
  async createUpload(): Promise<UploadTarget> {
    this.refuse();
  }
}

export function fileStoreFromEnv(env: Record<string, string | undefined> = process.env): FileStore {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) return new SupabaseFileStore({ url, key, bucket: env.SUPABASE_BUCKET?.trim() || "files" });
  if (env.VERCEL) return new UnconfiguredStore();
  return new LocalFileStore(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.FILES_DIR?.trim() || ".data/uploads"));
}

let store: FileStore | undefined;

export function getFileStore(): FileStore {
  store ??= fileStoreFromEnv();
  return store;
}
