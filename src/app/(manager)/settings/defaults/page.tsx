import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { people, properties, propertyStepDefaults } from "@/db/schema";
import { DEFAULT_TEMPLATE_STEPS } from "@/domain/workflow/default-template";
import { getDb } from "@/server/db";
import { loadTemplate } from "@/server/workflow";
import { Section } from "../section";
import { DefaultsRow } from "./defaults-row";

export const metadata: Metadata = { title: "Default assignees" };

export default function DefaultsPage() {
  return (
    <Section
      title="Default assignees"
      path="/settings/defaults"
      description="Who does each step at each property. New turnovers start with these people, and you can change them per turnover."
    >
      {async () => {
        const db = await getDb();
        const [propertyRows, personRows, defaultRows, steps] = await Promise.all([
          db.select({ id: properties.id, name: properties.name }).from(properties).where(eq(properties.active, true)).orderBy(asc(properties.sortOrder)),
          db.select({ id: people.id, name: people.name, roles: people.roles }).from(people).where(eq(people.active, true)).orderBy(asc(people.name)),
          db.select().from(propertyStepDefaults),
          loadTemplate(db).then(
            (t) => t.steps,
            () => DEFAULT_TEMPLATE_STEPS,
          ),
        ]);
        return (
          <div className="space-y-3">
            {propertyRows.map((property) => (
              <DefaultsRow
                key={property.id}
                property={property}
                steps={steps.map((s) => ({ key: s.key, name: s.name, role: s.role }))}
                people={personRows}
                current={Object.fromEntries(defaultRows.filter((d) => d.propertyId === property.id).map((d) => [d.stepKey, d.personId]))}
              />
            ))}
          </div>
        );
      }}
    </Section>
  );
}
