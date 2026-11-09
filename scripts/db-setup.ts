/**
 * npm run db:setup (also runs before `npm run dev`)
 *
 * Brings the database up to date. A brand-new local database is filled with
 * demo data; a brand-new production database (DATABASE_URL) only gets the
 * basics: settings, the six-step template and your ten properties. With
 * Supabase photo storage set up, it also makes the private bucket for photos.
 * Vercel runs this before every build (see "vercel-build" in package.json).
 */
import "./env";
import { migrateDatabase, openDatabase } from "@/db/client";
import { seedBase } from "@/db/seed/base";
import { DEMO_LOGIN, isEmpty, seedDemo } from "@/db/seed/demo";
import { ALLOWED_TYPES, MAX_FILE_BYTES } from "@/server/files/attachments";
import { fileStoreFromEnv } from "@/server/files/store";
import { SupabaseFileStore } from "@/server/files/supabase-store";

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
    // Production photo storage: make the private bucket on the first deploy.
    const store = fileStoreFromEnv();
    if (store instanceof SupabaseFileStore) {
      const bucket = await store.ensureBucket({ maxBytes: MAX_FILE_BYTES, types: Object.keys(ALLOWED_TYPES) });
      console.log(bucket === "created" ? "Created the private bucket for photos." : "Photo storage is ready.");
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
