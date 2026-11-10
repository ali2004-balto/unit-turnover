import { and, arrayContains, count, eq, not } from "drizzle-orm";
import { Check } from "lucide-react";
import Link from "next/link";
import { people, propertyStepDefaults } from "@/db/schema";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { notificationMode } from "@/server/notifications/providers";

/** What a brand-new install needs, in order. Shown on the dashboard until the first turnover. */
export async function GettingStarted() {
  const db = await getDb();
  const [[{ team }], [{ defaults }]] = await Promise.all([
    db
      .select({ team: count() })
      .from(people)
      .where(and(eq(people.active, true), not(arrayContains(people.roles, ["admin"])))),
    db.select({ defaults: count() }).from(propertyStepDefaults),
  ]);
  const live = notificationMode() === "live";
  const steps = [
    {
      done: team > 0,
      title: "Add your team",
      body: "Inspectors, crews, cleaners, photographers and leasing, with their mobile numbers.",
      href: "/settings/people",
      action: "Add people",
    },
    {
      done: defaults > 0,
      title: "Choose who does each step",
      body: "For each property, so new turnovers fill in their people by themselves.",
      href: "/settings/defaults",
      action: "Choose",
    },
    {
      done: false,
      title: "Bring in your sheet (optional)",
      body: "Add the units from your Master Tracker tab, with their statuses and notes.",
      href: "/settings/sheet",
      action: "Import",
    },
    {
      done: false,
      title: "Create your first turnover",
      body: "Or paste a list of units. The first step's person hears about it straight away.",
      href: "/turnovers/new",
      action: "New turnover",
    },
    {
      done: live,
      title: "Switch on texts and email",
      body: live ? "Messages are going out." : "Until then, every message is kept in Settings, Messages, so you can try things first.",
      href: "/settings/messages",
      action: "Messages",
    },
  ];
  return (
    <section aria-labelledby="getting-started" className="rounded-lg border border-border bg-card p-5">
      <h2 id="getting-started" className="font-semibold">
        Get set up
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">No turnovers yet. Here&apos;s what to do first.</p>
      <ol className="mt-4 divide-y divide-border">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
                s.done ? "border-st-done-fg bg-st-done-bg text-st-done-fg" : "border-border text-muted-foreground",
              )}
            >
              {s.done ? <Check className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", s.done && "text-muted-foreground line-through")}>
                {s.title}
                {s.done ? <span className="sr-only"> (done)</span> : null}
              </p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
            <Link
              href={s.href}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-muted"
            >
              {s.action}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
