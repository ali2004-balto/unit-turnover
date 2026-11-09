/**
 * npm run admin:create -- --email you@example.com --name "Your Name"
 *
 * Creates a manager who can sign in with a password, or gives an existing
 * person the manager role and a new password. The password is generated and
 * printed once; change it after signing in (Settings → People).
 */
import "./env";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { migrateDatabase, openDatabase } from "@/db/client";
import { people } from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import { deleteSessionsFor, setPassword } from "@/server/auth/sessions";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1]?.trim();
}

async function main() {
  const email = arg("--email")?.toLowerCase();
  const name = arg("--name");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name"');
    process.exit(1);
  }
  const handle = await openDatabase();
  try {
    await migrateDatabase(handle);
    await seedBase(handle.db);
    const [existing] = await handle.db.select().from(people).where(sql`lower(${people.email}) = ${email}`);
    let personId: string;
    if (existing) {
      personId = existing.id;
      await handle.db
        .update(people)
        .set({ roles: [...new Set([...existing.roles, "admin" as const])], active: true, ...(name ? { name } : {}) })
        .where(sql`${people.id} = ${existing.id}`);
    } else {
      if (!name) throw new Error("--name is required for a new person");
      const [created] = await handle.db.insert(people).values({ name, email, roles: ["admin"], notifyChannel: "email" }).returning();
      personId = created.id;
    }
    const password = randomBytes(12).toString("base64url");
    await setPassword(handle.db, personId, password);
    await deleteSessionsFor(handle.db, personId);
    console.log(`${existing ? "Updated" : "Created"} manager ${email}.`);
    console.log(`Password: ${password}`);
    console.log("Sign in, then change it in Settings → People.");
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
