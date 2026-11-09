import { asc, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { workflowTemplates, workflowTemplateSteps } from "@/db/schema";
import { getDb } from "@/server/db";
import { duplicateTemplateAction, makeDefaultTemplateAction } from "../actions";
import { Section } from "../section";

export const metadata: Metadata = { title: "Workflows" };

export default function TemplatesPage() {
  return (
    <Section
      title="Workflows"
      path="/settings/templates"
      description="The steps a turnover goes through. Each turnover keeps a copy of its workflow, so editing one never changes units already under way."
    >
      {async () => {
        const db = await getDb();
        const [templates, counts] = await Promise.all([
          db.select().from(workflowTemplates).where(eq(workflowTemplates.active, true)).orderBy(asc(workflowTemplates.name)),
          db.select({ templateId: workflowTemplateSteps.templateId, n: count() }).from(workflowTemplateSteps).groupBy(workflowTemplateSteps.templateId),
        ]);
        const steps = new Map(counts.map((c) => [c.templateId, c.n]));
        return (
          <ul className="space-y-3">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {t.name}
                    {t.isDefault ? <span className="ml-2 rounded bg-st-done-bg px-1.5 py-0.5 text-xs font-normal text-st-done-fg">Default</span> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{steps.get(t.id) ?? 0} steps</p>
                </div>
                <Link href={`/settings/templates/${t.id}`} className="h-8 content-center rounded-md px-3 text-sm font-medium text-primary hover:bg-muted">
                  Edit steps
                </Link>
                <form action={duplicateTemplateAction}>
                  <input type="hidden" name="templateId" value={t.id} />
                  <button type="submit" className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                    Duplicate
                  </button>
                </form>
                {!t.isDefault ? (
                  <form action={makeDefaultTemplateAction}>
                    <input type="hidden" name="templateId" value={t.id} />
                    <button type="submit" className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                      Make default
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        );
      }}
    </Section>
  );
}
