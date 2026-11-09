/**
 * npm run db:setup (also runs before `npm run dev`)
 *
 * Brings the database up to date. A brand-new local database is filled with
 * demo data; a brand-new production database (DATABASE_URL) only gets the
 * basics: settings, the six-step template and your ten properties.
 */
import "./env";
import { migrateDatabase, openDatabase } from "@/db/client";
import { seedBase } from "@/db/seed/base";
import { DEMO_LOGIN, isEmpty, seedDemo } from "@/db/seed/demo";

async function main() {
  const handle = await openDatabase();
  try {
    await migrateDatabase(handle);
    if (await isEmpty(handle.db)) {
      if (handle.kind === "pglite") {
        const { today } = await seedDemo(handle.db);
        console.log(`Loaded demo data (dates relative to ${today}).`);
        console.log(`Sign in as ${DEMO_LOGIN.email} with the password ${DEMO_LOGIN.password}`);
      } else {
        await seedBase(handle.db);
        console.log("Database ready: settings, the default workflow and your properties are in place.");
      }
    } else {
      console.log("Database is up to date.");
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
