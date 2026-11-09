/**
 * Opens the database.
 *
 * - With DATABASE_URL set (production, or your own Postgres): connects to it.
 * - Without it (development and tests): an embedded Postgres (PGlite) stored
 *   in .data/pglite, so the app runs with nothing to install or sign up for.
 *
 * Both use the same schema and migrations.
 */
import path from "node:path";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Either the database or an open transaction. */
export type Executor = DB | Tx;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "src", "db", "migrations");

export interface DbHandle {
  db: DB;
  kind: "pglite" | "postgres";
  close: () => Promise<void>;
}

export type DatabaseConfig = { kind: "postgres"; url: string } | { kind: "pglite"; dataDir: string | null };

export function databaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const url = env.DATABASE_URL?.trim();
  if (url) return { kind: "postgres", url };
  return { kind: "pglite", dataDir: path.resolve(process.cwd(), env.PGLITE_DATA_DIR?.trim() || ".data/pglite") };
}

/** dataDir null = in memory (tests). */
export async function openPglite(dataDir: string | null): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  return { db, kind: "pglite", close: () => client.close() };
}

export async function openPostgres(url: string): Promise<DbHandle> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  // prepare: false keeps it compatible with Supabase's connection pooler.
  const client = postgres(url, { max: 5, prepare: false });
  const db = drizzle(client, { schema }) as unknown as DB;
  return { db, kind: "postgres", close: () => client.end() };
}

export async function openDatabase(config: DatabaseConfig = databaseConfig()): Promise<DbHandle> {
  return config.kind === "postgres" ? openPostgres(config.url) : openPglite(config.dataDir);
}

/** Applies any migrations that haven't run yet. Safe to call every start. */
export async function migrateDatabase(handle: DbHandle): Promise<void> {
  if (handle.kind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

export { schema };
