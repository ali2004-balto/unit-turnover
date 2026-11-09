import "server-only";
import { type DB, type DbHandle, migrateDatabase, openDatabase } from "@/db/client";

const globalForDb = globalThis as unknown as { __unitTurnoverDb?: Promise<DbHandle> };

/**
 * The app's database connection, opened once per server process (and kept
 * across hot reloads in development). The local embedded database is
 * migrated on first use; a production database is migrated by
 * `npm run db:migrate` during deploy.
 */
export async function getDb(): Promise<DB> {
  globalForDb.__unitTurnoverDb ??= (async () => {
    const handle = await openDatabase();
    if (handle.kind === "pglite") await migrateDatabase(handle);
    return handle;
  })();
  try {
    return (await globalForDb.__unitTurnoverDb).db;
  } catch (error) {
    globalForDb.__unitTurnoverDb = undefined;
    throw error;
  }
}
