import { describe, expect, it } from "vitest";
import { X509Certificate } from "node:crypto";
import { databaseConfig, POOL_OPTIONS, sslFor } from "./client";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("the production database connection", () => {
  it("checks Supabase's certificate against Supabase's own authority, and leaves other databases to their address", () => {
    expect(sslFor("postgresql://postgres.abc:pw@aws-1-ca-central-1.pooler.supabase.com:6543/postgres")).toEqual({ ca: SUPABASE_ROOT_CA });
    expect(sslFor("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres")).toEqual({ ca: SUPABASE_ROOT_CA });
    expect(sslFor("postgresql://postgres@127.0.0.1:5433/turnover")).toBeUndefined();
    expect(sslFor("postgresql://u:pw@db.example/app?sslmode=require")).toBeUndefined();
    expect(sslFor("postgresql://u:pw@notsupabase.com/app")).toBeUndefined();
  });

  it("bundles Supabase's root certificate authority", () => {
    const ca = new X509Certificate(SUPABASE_ROOT_CA);
    expect(ca.subject).toContain("CN=Supabase Root 2021 CA");
    expect(ca.ca).toBe(true);
    expect(ca.fingerprint256).toBe("80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
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
