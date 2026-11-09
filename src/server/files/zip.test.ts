import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FileStore } from "./store";
import { zipStream } from "./zip";

function memoryStore(files: Record<string, Uint8Array>, reads: string[] = []): FileStore {
  return {
    async get(key) {
      reads.push(key);
      return files[key] ? { data: files[key], contentType: "image/jpeg" } : null;
    },
    async put() {},
    async remove() {},
  };
}

const KITCHEN = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
const BATH = new Uint8Array(200_000).fill(7);

describe("the photo zip", () => {
  it("holds every photo, under its numbered name, skipping any that are gone", async () => {
    const store = memoryStore({ "a/1.jpg": KITCHEN, "a/2.jpg": BATH });
    const stream = zipStream(store, [
      { name: "001-kitchen.jpg", key: "a/1.jpg" },
      { name: "002-gone.jpg", key: "a/missing.jpg" },
      { name: "003-bath.jpg", key: "a/2.jpg" },
    ]);
    const files = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
    expect(Object.keys(files)).toEqual(["001-kitchen.jpg", "003-bath.jpg"]);
    expect(files["001-kitchen.jpg"]).toEqual(KITCHEN);
    expect(files["003-bath.jpg"]).toEqual(BATH);
  });

  it("reads photos one at a time, as the download asks for more", async () => {
    const reads: string[] = [];
    const store = memoryStore({ "a/1.jpg": KITCHEN, "a/2.jpg": BATH, "a/3.jpg": KITCHEN }, reads);
    const reader = zipStream(store, ["a/1.jpg", "a/2.jpg", "a/3.jpg"].map((key, i) => ({ name: `${i}.jpg`, key }))).getReader();
    await reader.read();
    expect(reads).toEqual(["a/1.jpg"]);
    while (!(await reader.read()).done);
    expect(reads).toEqual(["a/1.jpg", "a/2.jpg", "a/3.jpg"]);
  });
});
