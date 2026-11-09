import { Zip, ZipPassThrough } from "fflate";
import type { FileStore } from "./store";

/**
 * A zip that's written while it downloads: one photo is read from storage at a
 * time and sent on, so a unit with hundreds of megabytes of photos never sits
 * in the server's memory all at once.
 */
export function zipStream(store: FileStore, files: Array<{ name: string; key: string }>): ReadableStream<Uint8Array> {
  const ready: Uint8Array[] = [];
  let finished = false;
  let failure: Error | null = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error;
    else ready.push(chunk);
    if (final) finished = true;
  });
  let next = 0;
  return new ReadableStream({
    async pull(controller) {
      while (ready.length === 0 && !finished && !failure) {
        if (next < files.length) {
          const file = files[next++];
          const stored = await store.get(file.key);
          if (!stored) continue;
          const entry = new ZipPassThrough(file.name);
          zip.add(entry);
          entry.push(stored.data, true);
        } else {
          zip.end();
          if (ready.length === 0 && !finished) failure = new Error("The zip didn't finish.");
        }
      }
      if (failure) return controller.error(failure);
      while (ready.length > 0) controller.enqueue(ready.shift()!);
      if (finished) controller.close();
    },
  });
}
