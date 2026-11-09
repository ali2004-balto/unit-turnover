/**
 * Photos and files in Supabase Storage, in a private bucket ("files" unless
 * SUPABASE_BUCKET says otherwise).
 *
 * - Browsers upload straight to storage with a one-time upload address the
 *   app hands out after checking they may add to that step.
 * - Browsers view files through links that work for 5 minutes, handed out
 *   by the app after the same kind of check. The bucket itself is never public.
 * - The service key stays on the server: it never reaches a browser.
 *
 * Talks to Storage's HTTP API directly, so there's no extra library.
 */
import type { FileStore, StoredFile, UploadTarget } from "./store";
import { assertSafeKey } from "./keys";

export interface SupabaseStorageConfig {
  /** https://<project>.supabase.co */
  url: string;
  /** The project's service role (secret) key. */
  key: string;
  bucket: string;
}

const LINK_SECONDS = 300;

export class SupabaseFileStore implements FileStore {
  constructor(
    private readonly config: SupabaseStorageConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private api(path: string): string {
    return `${this.config.url.replace(/\/+$/, "")}/storage/v1${path}`;
  }

  private object(key: string): string {
    assertSafeKey(key);
    return `${this.config.bucket}/${key}`;
  }

  private async call(path: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { apikey: this.config.key, ...init.headers };
    // Older (JWT) service keys also go in Authorization; the newer sb_secret_ keys only need apikey.
    if (this.config.key.startsWith("eyJ")) headers.Authorization = `Bearer ${this.config.key}`;
    try {
      return await this.fetchImpl(this.api(path), { ...init, headers, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new Error(`Photo storage couldn't be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async refused(response: Response, what: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(`Photo storage wouldn't ${what} (${response.status}): ${body.message ?? body.error ?? response.statusText}`);
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const response = await this.call(`/object/${this.object(key)}`, {
      method: "POST",
      body: new Uint8Array(data),
      headers: { "Content-Type": contentType, "x-upsert": "false", "cache-control": "max-age=31536000" },
    });
    if (!response.ok) await this.refused(response, "save the file");
  }

  async get(key: string): Promise<StoredFile | null> {
    const response = await this.call(`/object/authenticated/${this.object(key)}`);
    // Storage answers 400 or 404 for a missing file, depending on its version.
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) await this.refused(response, "read the file");
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async remove(key: string): Promise<void> {
    const response = await this.call(`/object/${this.config.bucket}`, {
      method: "DELETE",
      body: JSON.stringify({ prefixes: [this.object(key).slice(this.config.bucket.length + 1)] }),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok && response.status !== 404) await this.refused(response, "delete the file");
  }

  async createUpload(key: string, contentType: string): Promise<UploadTarget> {
    const response = await this.call(`/object/upload/sign/${this.object(key)}`, { method: "POST" });
    if (!response.ok) await this.refused(response, "accept an upload");
    const { url } = (await response.json()) as { url: string };
    return { url: this.api(url), method: "PUT", headers: { "Content-Type": contentType } };
  }

  async stat(key: string): Promise<{ size: number; contentType: string | null } | null> {
    const object = this.object(key).slice(this.config.bucket.length + 1);
    const slash = object.lastIndexOf("/");
    const [folder, name] = [object.slice(0, slash + 1), object.slice(slash + 1)];
    const response = await this.call(`/object/list/${this.config.bucket}`, {
      method: "POST",
      body: JSON.stringify({ prefix: folder, search: name, limit: 10, offset: 0 }),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) await this.refused(response, "look up the file");
    const items = (await response.json()) as Array<{ name: string; metadata?: { size?: number; contentLength?: number; mimetype?: string } | null }>;
    const item = items.find((i) => i.name === name);
    if (!item?.metadata) return null;
    return { size: Number(item.metadata.size ?? item.metadata.contentLength ?? NaN), contentType: item.metadata.mimetype ?? null };
  }

  async downloadUrl(key: string, opts: { fileName: string; download: boolean }): Promise<string> {
    const response = await this.call(`/object/sign/${this.object(key)}`, {
      method: "POST",
      body: JSON.stringify({ expiresIn: LINK_SECONDS }),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) await this.refused(response, "share the file");
    const { signedURL } = (await response.json()) as { signedURL: string };
    const url = new URL(this.api(signedURL));
    if (opts.download) url.searchParams.set("download", opts.fileName);
    return url.toString();
  }

  /** Makes the private bucket if it isn't there yet, limited to the file types and size the app accepts. */
  async ensureBucket(opts: { maxBytes: number; types: string[] }): Promise<"created" | "exists"> {
    const existing = await this.call(`/bucket/${this.config.bucket}`);
    if (existing.ok) return "exists";
    const created = await this.call("/bucket", {
      method: "POST",
      body: JSON.stringify({
        id: this.config.bucket,
        name: this.config.bucket,
        public: false,
        file_size_limit: opts.maxBytes,
        allowed_mime_types: opts.types,
      }),
      headers: { "Content-Type": "application/json" },
    });
    if (!created.ok) await this.refused(created, "create the storage bucket");
    return "created";
  }
}
