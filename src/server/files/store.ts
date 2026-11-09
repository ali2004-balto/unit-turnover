/**
 * Where uploaded photos and files are kept. Development stores them in a
 * local folder (.data/uploads). Production will use Supabase Storage behind
 * the same interface (Phase 4).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredFile {
  data: Uint8Array;
  contentType: string;
}

export interface FileStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  remove(key: string): Promise<void>;
}

/** Keys are made by the app ("turnovers/<id>/<step>/<id>.jpg"); anything else is refused. */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) throw new Error(`Unsafe storage key: ${key}`);
}

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

let store: FileStore | undefined;

export function getFileStore(): FileStore {
  store ??= new LocalFileStore(path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.FILES_DIR?.trim() || ".data/uploads"));
  return store;
}
