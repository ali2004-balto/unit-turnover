import { describe, expect, it } from "vitest";
import { databaseConfig, POOL_OPTIONS } from "./client";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("the production database connection", () => {
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
