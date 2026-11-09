/**
 * The local embedded database can only be opened by one program at a time.
 * Whoever opens it writes their process id next to it; anyone else who tries
 * gets a clear message instead of silently corrupting the data.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const lockFile = (dataDir: string) => `${dataDir}.lock`;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class DatabaseInUseError extends Error {
  constructor() {
    super("The local database is open in another program (probably `npm run dev`). Stop it first (Ctrl+C), then try again.");
    this.name = "DatabaseInUseError";
  }
}

/** Claims the database folder for this process. Returns a function that releases it. */
export function claimDatabase(dataDir: string): () => void {
  const file = lockFile(dataDir);
  let holder = 0;
  try {
    holder = Number(readFileSync(file, "utf8"));
  } catch {
    // No lock file: nobody has it open.
  }
  if (holder && holder !== process.pid && isRunning(holder)) throw new DatabaseInUseError();
  writeFileSync(file, String(process.pid));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file);
    } catch {
      // Already gone.
    }
  };
  process.once("exit", release);
  return release;
}
