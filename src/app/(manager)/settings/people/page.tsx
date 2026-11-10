import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { credentials, people } from "@/db/schema";
import { ROLE_LABELS } from "@/domain/workflow/types";
import { cn } from "@/lib/utils";
import { getCurrentSession } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { notificationSetup } from "@/server/notifications/providers";
import { Section } from "../section";
import { SignInLinkButton } from "@/components/sign-in-link-button";
import { PasswordDialog, PersonDialog, SignOutButton } from "./person-dialogs";

export const metadata: Metadata = { title: "People" };

const CHANNEL: Record<string, string> = { sms: "Text", email: "Email", both: "Text and email", none: "Nothing" };

export default function PeoplePage() {
  return (
    <Section
      title="People"
      path="/settings/people"
      description="Everyone who works on turnovers. Managers sign in with a password. Everyone else gets a link with each task, and once they've opened one, their phone stays signed in."
    >
      {async () => {
        const db = await getDb();
        const [rows, withPassword, me] = await Promise.all([
          db.select().from(people).orderBy(asc(people.name)),
          db.select({ id: credentials.personId }).from(credentials),
          getCurrentSession(),
        ]);
        const hasPassword = new Set(withPassword.map((c) => c.id));
        const placeholders = rows.filter((p) => p.isPlaceholder && p.active).length;
        const setup = notificationSetup();
        const oneWayOnly =
          setup.mode !== "live" || setup.sms === setup.email
            ? null
            : setup.email
              ? "Texts aren't set up yet, so people who chose texts get email instead. Anyone without an email address won't hear from the app until texts are added."
              : "Email isn't set up yet, so people who chose email get texts instead. Anyone without a phone number won't hear from the app until email is added.";
        return (
          <div className="space-y-3">
            {oneWayOnly ? (
              <p className="rounded-lg border border-border bg-st-progress-bg px-4 py-2.5 text-sm text-st-progress-fg">{oneWayOnly}</p>
            ) : null}
            {placeholders > 0 ? (
              <p className="rounded-lg border border-border bg-st-progress-bg px-4 py-2.5 text-sm text-st-progress-fg">
                {placeholders} placeholder {placeholders === 1 ? "person is" : "people are"} from the demo data. Rename them to your team, with real
                phone numbers and emails, or deactivate them.
              </p>
            ) : null}
            <PersonDialog />
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Roles</th>
                    <th className="px-4 py-2 font-medium">Phone</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Hears by</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={cn("border-t border-border", !p.active && "text-muted-foreground")}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">
                        {p.name}
                        {p.company ? <span className="block text-xs font-normal text-muted-foreground">{p.company}</span> : null}
                        {p.isPlaceholder ? <span className="ml-2 rounded bg-st-progress-bg px-1.5 py-0.5 text-[11px] font-normal text-st-progress-fg">Placeholder</span> : null}
                        {!p.active ? <span className="ml-2 text-xs font-normal">(inactive)</span> : null}
                      </td>
                      <td className="px-4 py-2">{p.roles.map((r) => ROLE_LABELS[r]).join(", ")}</td>
                      <td className="px-4 py-2 whitespace-nowrap tabular-nums">{p.phone ?? "–"}</td>
                      <td className="px-4 py-2">{p.email ?? "–"}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{CHANNEL[p.notifyChannel]}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          <PersonDialog
                            person={{
                              id: p.id,
                              name: p.name,
                              email: p.email,
                              phone: p.phone,
                              company: p.company,
                              roles: p.roles,
                              notifyChannel: p.notifyChannel,
                              active: p.active,
                            }}
                          />
                          {p.roles.includes("admin") ? <PasswordDialog personId={p.id} name={p.name} hasPassword={hasPassword.has(p.id)} /> : null}
                          {p.active ? <SignInLinkButton personId={p.id} personName={p.name} /> : null}
                          {p.id !== me?.person.id && p.active ? <SignOutButton personId={p.id} /> : null}
                        </div>
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
