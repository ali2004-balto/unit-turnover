/**
 * Opens the database.
 *
 * - With DATABASE_URL set (production, or your own Postgres): connects to it.
 * - Without it (development and tests): an embedded Postgres (PGlite) stored
 *   in .data/pglite, so the app runs with nothing to install or sign up for.
 *
 * Both use the same schema and migrations.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { claimDatabase } from "./dev-lock";
import * as schema from "./schema";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

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
  // Vercel has no lasting disk: the embedded database would lose everything.
  if (env.VERCEL) throw new Error("DATABASE_URL isn't set. Add your Supabase connection string in the Vercel project's settings.");
  // Development only: production sets DATABASE_URL, so don't make the bundler trace this folder.
  return {
    kind: "pglite",
    dataDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.PGLITE_DATA_DIR?.trim() || ".data/pglite"),
  };
}

/** dataDir null = in memory (tests). */
export async function openPglite(dataDir: string | null): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  let release = () => {};
  if (dataDir) {
    await mkdir(dataDir, { recursive: true });
    release = claimDatabase(dataDir);
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  return {
    db,
    kind: "pglite",
    close: async () => {
      await client.close();
      release();
    },
  };
}

/**
 * Production talks to Postgres through Supabase's connection pooler, which
 * lends a database connection for one query or transaction at a time. The
 * pg driver suits it: each connection waits for one query's answer before
 * sending the next, and it doesn't keep prepared statements. (postgres.js,
 * used before, sends queries back to back on a busy connection; through the
 * pooler, answers then reached the wrong query: pages hung, or failed on
 * another query's rows.)
 *
 * - query_timeout: a query that gets no answer fails after a minute rather
 *   than holding the page until the server gives up on it;
 * - idleTimeoutMillis: connections unused for 20 seconds are closed, rather
 *   than kept by a server that may be paused for a while.
 *
 * The connection to Supabase is encrypted, and Supabase's certificate is
 * checked against Supabase's own authority (see supabase-ca.ts). Elsewhere,
 * encryption follows the address's sslmode, as with psql.
 */
export const POOL_OPTIONS = { max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000, query_timeout: 60_000 } as const;

/** TLS settings for a database address: Supabase's own authority for Supabase, otherwise whatever the address says. */
export function sslFor(url: string): { ca: string } | undefined {
  const { hostname, searchParams } = new URL(url);
  if (searchParams.has("sslmode")) return undefined;
  return /(^|\.)supabase\.(com|co)$/.test(hostname) ? { ca: SUPABASE_ROOT_CA } : undefined;
}

export async function openPostgres(url: string): Promise<DbHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, ...POOL_OPTIONS, ssl: sslFor(url) });
  // A connection that drops while unused (the pooler restarting, say) is replaced on next use; it mustn't crash the server.
  pool.on("error", (error) => console.error("A database connection dropped:", error.message));
  const db = drizzle(pool, { schema }) as unknown as DB;
  return { db, kind: "postgres", close: () => pool.end() };
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
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

export { schema };
