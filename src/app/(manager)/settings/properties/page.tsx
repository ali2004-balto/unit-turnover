import { and, asc, count, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { properties, turnovers } from "@/db/schema";
import { getDb } from "@/server/db";
import { Section } from "../section";
import { PropertyDialog } from "./property-dialog";

export const metadata: Metadata = { title: "Properties" };

export default function PropertiesPage() {
  return (
    <Section
      title="Properties"
      path="/settings/properties"
      description="Access notes (lockbox, keys, parking) are shown only to whoever has a unit's active step."
    >
      {async () => {
        const db = await getDb();
        const [rows, open] = await Promise.all([
          db.select().from(properties).orderBy(asc(properties.sortOrder), asc(properties.name)),
          db
            .select({ propertyId: turnovers.propertyId, n: count() })
            .from(turnovers)
            .where(and(isNull(turnovers.completedAt), isNull(turnovers.archivedAt)))
            .groupBy(turnovers.propertyId),
        ]);
        const openCount = new Map(open.map((o) => [o.propertyId, o.n]));
        return (
          <div className="space-y-3">
            <PropertyDialog />
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Property</th>
                    <th className="px-4 py-2 font-medium">Address</th>
                    <th className="px-4 py-2 font-medium">Access notes</th>
                    <th className="px-4 py-2 text-right font-medium">Turnovers in progress</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-2 font-medium">
                        {p.name}
                        {!p.active ? <span className="ml-2 text-xs font-normal text-muted-foreground">(inactive)</span> : null}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{p.address ?? "–"}</td>
                      <td className="max-w-64 truncate px-4 py-2 text-muted-foreground">{p.accessNotes ?? "–"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{openCount.get(p.id) ?? 0}</td>
                      <td className="px-4 py-2 text-right">
                        <PropertyDialog property={{ id: p.id, name: p.name, address: p.address, accessNotes: p.accessNotes, active: p.active }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Section>
  );
}
