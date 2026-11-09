/**
 * npm run db:migrate
 *
 * Applies new migrations to the database in DATABASE_URL (or the local one).
 * Run it once per deploy, before the new version starts.
 */
import { migrateDatabase, openDatabase } from "@/db/client";

async function main() {
  const handle = await openDatabase();
  try {
    await migrateDatabase(handle);
    console.log(`Migrations applied (${handle.kind}).`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
