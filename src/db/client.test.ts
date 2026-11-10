import { describe, expect, it } from "vitest";
import { databaseConfig, POOL_OPTIONS, sslFor } from "./client";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("the production database connection", () => {
  it("encrypts the connection to Supabase, but not to a Postgres on this machine", () => {
    expect(sslFor("postgresql://postgres.abc:pw@aws-1-ca-central-1.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(sslFor("postgresql://postgres@127.0.0.1:5433/turnover")).toBe(false);
    expect(sslFor("postgresql://postgres@localhost/turnover")).toBe(false);
    expect(sslFor("postgresql://u:pw@db.example/app?sslmode=disable")).toBe(false);
  });

  it("gives up on a query with no answer, and closes connections left unused", () => {
    expect(POOL_OPTIONS).toMatchObject({ query_timeout: 60_000, idleTimeoutMillis: 20_000 });
  });

  it("uses DATABASE_URL when it's set, and won't run on Vercel without it", () => {
    expect(databaseConfig(env({ DATABASE_URL: " postgresql://db.example/app " }))).toEqual({
      kind: "postgres",
      url: "postgresql://db.example/app",
    });
    expect(() => databaseConfig(env({ VERCEL: "1" }))).toThrow(/DATABASE_URL isn't set/);
  });
});
