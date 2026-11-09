/**
 * A fresh in-memory Postgres for each test, with migrations, the base seed,
 * and one person per role.
 */
import { migrateDatabase, openPglite } from "@/db/client";
import { people, propertyStepDefaults } from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import type { Actor, Role } from "@/domain/workflow/types";

export async function createTestDb() {
  const handle = await openPglite(null);
  await migrateDatabase(handle);
  const { db } = handle;
  const base = await seedBase(db);

  const cast: Array<[string, Role]> = [
    ["Admin", "admin"],
    ["Inspector", "inspector"],
    ["Crew A", "crew"],
    ["Crew B", "crew"],
    ["Cleaner", "cleaner"],
    ["Photographer", "photographer"],
    ["Leasing", "leasing"],
  ];
  const rows = await db
    .insert(people)
    .values(cast.map(([name, r]) => ({ name, roles: [r] })))
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

  const as = (personId: string): Actor => ({
    personId,
    roles: [rows.find((r) => r.id === personId)!.roles[0]],
  });

  return { db, handle, ids, as, propertyIds: base.propertyIds, templateId: base.templateId };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
