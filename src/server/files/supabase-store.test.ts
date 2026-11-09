import { describe, expect, it } from "vitest";
import { fileStoreFromEnv, LocalFileStore } from "./store";
import { SupabaseFileStore } from "./supabase-store";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** Answers each request with the first matching reply, and remembers what was asked. */
function fakeStorage(replies: Array<[method: string, path: string, reply: () => Response]>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    const match = replies.find(([m, path]) => m === method && url.startsWith(`https://abc.supabase.co/storage/v1${path}`));
    return match ? match[2]() : new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const KEY = "turnovers/t1/s1/0b6f3c4e-1111-4222-8333-944455556666.jpg";
const config = (key = "eyJhbGciOiJIUzI1NiJ9.service.role") => ({ url: "https://abc.supabase.co/", key, bucket: "files" });

describe("Supabase Storage", () => {
  it("saves, reads and deletes files in the private bucket", async () => {
    const { calls, fetchImpl } = fakeStorage([
      ["POST", `/object/files/${KEY}`, json({ Key: `files/${KEY}` })],
      ["GET", `/object/authenticated/files/${KEY}`, () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } })],
      ["DELETE", "/object/files", json([])],
    ]);
    const store = new SupabaseFileStore(config(), fetchImpl);
    await store.put(KEY, new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(await store.get(KEY)).toEqual({ data: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    await store.remove(KEY);

    expect(calls[0]).toMatchObject({ method: "POST", url: `https://abc.supabase.co/storage/v1/object/files/${KEY}` });
    expect(calls[0].headers).toMatchObject({
      apikey: config().key,
      authorization: `Bearer ${config().key}`,
      "content-type": "image/jpeg",
      "x-upsert": "false",
    });
    expect(calls[2]).toMatchObject({ method: "DELETE", url: "https://abc.supabase.co/storage/v1/object/files", body: { prefixes: [KEY] } });
  });

  it("sends a newer sb_secret key only as the apikey", async () => {
    const { calls, fetchImpl } = fakeStorage([["POST", "/object/files/", json({})]]);
    await new SupabaseFileStore(config("sb_secret_abc"), fetchImpl).put(KEY, new Uint8Array([1]), "image/jpeg");
    expect(calls[0].headers.apikey).toBe("sb_secret_abc");
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("treats a missing file as missing, and says what went wrong otherwise", async () => {
    const { fetchImpl } = fakeStorage([
      ["GET", "/object/authenticated/files/turnovers/t1/s1/gone", json({ message: "Object not found" }, 400)],
      ["POST", "/object/files/", json({ message: "The resource already exists" }, 409)],
    ]);
    const store = new SupabaseFileStore(config(), fetchImpl);
    expect(await store.get("turnovers/t1/s1/gone.jpg")).toBeNull();
    await expect(store.put(KEY, new Uint8Array([1]), "image/jpeg")).rejects.toThrow("Photo storage wouldn't save the file (409): The resource already exists");
    await expect(store.put("../secrets.jpg", new Uint8Array([1]), "image/jpeg")).rejects.toThrow(/Unsafe storage key/);
  });

  it("hands out a one-time upload address for the browser", async () => {
    const { fetchImpl } = fakeStorage([["POST", `/object/upload/sign/files/${KEY}`, json({ url: `/object/upload/sign/files/${KEY}?token=up123` })]]);
    expect(await new SupabaseFileStore(config(), fetchImpl).createUpload(KEY, "image/jpeg")).toEqual({
      url: `https://abc.supabase.co/storage/v1/object/upload/sign/files/${KEY}?token=up123`,
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
    });
  });

  it("finds an uploaded file's size by listing its folder", async () => {
    const name = KEY.split("/").pop()!;
    const { calls, fetchImpl } = fakeStorage([["POST", "/object/list/files", json([{ name, metadata: { size: 52_000, mimetype: "image/jpeg" } }])]]);
    const store = new SupabaseFileStore(config(), fetchImpl);
    expect(await store.stat(KEY)).toEqual({ size: 52_000, contentType: "image/jpeg" });
    expect(calls[0].body).toEqual({ prefix: "turnovers/t1/s1/", search: name, limit: 10, offset: 0 });
    expect(await store.stat("turnovers/t1/s1/other.jpg")).toBeNull();
  });

  it("gives out viewing links that last five minutes", async () => {
    const { calls, fetchImpl } = fakeStorage([["POST", `/object/sign/files/${KEY}`, json({ signedURL: `/object/sign/files/${KEY}?token=view123` })]]);
    const store = new SupabaseFileStore(config(), fetchImpl);
    expect(await store.downloadUrl(KEY, { fileName: "kitchen.jpg", download: false })).toBe(
      `https://abc.supabase.co/storage/v1/object/sign/files/${KEY}?token=view123`,
    );
    expect(calls[0].body).toEqual({ expiresIn: 300 });
    expect(await store.downloadUrl(KEY, { fileName: "kitchen.jpg", download: true })).toMatch(/&download=kitchen\.jpg$/);
  });

  it("creates the private bucket once, limited to photos and PDFs", async () => {
    const { calls, fetchImpl } = fakeStorage([["POST", "/bucket", json({ name: "files" })]]);
    const store = new SupabaseFileStore(config(), fetchImpl);
    expect(await store.ensureBucket({ maxBytes: 1000, types: ["image/jpeg"] })).toBe("created");
    expect(calls[1].body).toEqual({ id: "files", name: "files", public: false, file_size_limit: 1000, allowed_mime_types: ["image/jpeg"] });
    const exists = fakeStorage([["GET", "/bucket/files", json({ name: "files" })]]);
    expect(await new SupabaseFileStore(config(), exists.fetchImpl).ensureBucket({ maxBytes: 1000, types: [] })).toBe("exists");
  });
});

describe("choosing where files go", () => {
  it("uses Supabase when it's set up, a local folder otherwise, and refuses on Vercel without it", async () => {
    expect(fileStoreFromEnv({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x" })).toBeInstanceOf(SupabaseFileStore);
    expect(fileStoreFromEnv({})).toBeInstanceOf(LocalFileStore);
    const vercel = fileStoreFromEnv({ VERCEL: "1" });
    await expect(vercel.put(KEY, new Uint8Array([1]), "image/jpeg")).rejects.toThrow(/storage isn't set up/);
  });
});
