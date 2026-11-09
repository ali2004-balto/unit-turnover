/**
 * A fresh in-memory Postgres for each test, with migrations, the base seed,
 * and one person per role. The first call per test file builds a template
 * database; every test then gets its own copy of it, which is much faster
 * than migrating from scratch each time.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { type DB, type DbHandle, migrateDatabase, schema } from "@/db/client";
import { people, propertyStepDefaults } from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import type { Actor, Role } from "@/domain/workflow/types";

const CAST: Array<[string, Role]> = [
  ["Admin", "admin"],
  ["Inspector", "inspector"],
  ["Crew A", "crew"],
  ["Crew B", "crew"],
  ["Cleaner", "cleaner"],
  ["Photographer", "photographer"],
  ["Leasing", "leasing"],
];

function wrap(client: PGlite): DbHandle {
  return { db: drizzle(client, { schema }) as unknown as DB, kind: "pglite", close: () => client.close() };
}

async function buildTemplate() {
  const client = new PGlite();
  const handle = wrap(client);
  await migrateDatabase(handle);
  const { db } = handle;
  const base = await seedBase(db);
  const rows = await db
    .insert(people)
    .values(CAST.map(([name, r]) => ({ name, roles: [r] })))
    .returning();
  const id = (name: string) => rows.find((r) => r.name === name)!.id;
  const ids = {
    admin: id("Admin"),
    inspector: id("Inspector"),
    crew: id("Crew A"),
    crew2: id("Crew B"),
    cleaner: id("Cleaner"),
    photographer: id("Photographer"),
    leasing: id("Leasing"),
  };
  const acadian = base.propertyIds.get("Acadian")!;
  await db.insert(propertyStepDefaults).values(
    Object.entries({
      inspection: ids.inspector,
      scope: ids.admin,
      work: ids.crew,
      cleaning: ids.cleaner,
      photos: ids.photographer,
      leasing: ids.leasing,
    }).map(([stepKey, personId]) => ({ propertyId: acadian, stepKey, personId })),
  );
  const roles = new Map(rows.map((r) => [r.id, r.roles]));
  return { client, ids, roles, propertyIds: base.propertyIds, templateId: base.templateId };
}

let template: ReturnType<typeof buildTemplate> | undefined;

export async function createTestDb() {
  template ??= buildTemplate();
  const t = await template;
  const handle = wrap((await t.client.clone()) as PGlite);
  const as = (personId: string): Actor => ({ personId, roles: [t.roles.get(personId)![0]] });
  return { db: handle.db, handle, ids: t.ids, as, propertyIds: t.propertyIds, templateId: t.templateId };
}

/** An empty database with only the migrations applied. */
export async function createEmptyDb(): Promise<DbHandle> {
  const handle = wrap(new PGlite());
  await migrateDatabase(handle);
  return handle;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
