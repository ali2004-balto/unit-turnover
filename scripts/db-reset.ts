/**
 * npm run db:reset              wipe the local database and reload demo data
 * npm run db:reset -- --empty   wipe it and start with only the basics
 *
 * Only works on the local development database. Stop `npm run dev` first.
 */
import { rm } from "node:fs/promises";
import { databaseConfig, migrateDatabase, openDatabase } from "@/db/client";
import { seedBase } from "@/db/seed/base";
import { seedDemo } from "@/db/seed/demo";

async function main() {
  const config = databaseConfig();
  if (config.kind !== "pglite" || !config.dataDir) {
    console.error("db:reset only resets the local development database. DATABASE_URL is set, so nothing was changed.");
    process.exit(1);
  }
  await rm(config.dataDir, { recursive: true, force: true });
  const handle = await openDatabase(config);
  try {
    await migrateDatabase(handle);
    if (process.argv.includes("--empty")) {
      await seedBase(handle.db);
      console.log("Local database reset. It has the basics and no turnovers.");
    } else {
      const { today } = await seedDemo(handle.db);
      console.log(`Local database reset with demo data (dates relative to ${today}).`);
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
