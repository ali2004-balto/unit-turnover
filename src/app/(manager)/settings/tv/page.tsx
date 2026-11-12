import type { Metadata } from "next";
import { getSettings } from "@/db/settings";
import { appBaseUrl } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { tvLinkUrl } from "@/server/queries/tv-board";
import { CopyField } from "../sheet/sheet-link";
import { Section } from "../section";
import { MakeTvLinkButton, TurnOffTvButton } from "./tv-link";

export const metadata: Metadata = { title: "TV" };

export default function TvSettingsPage() {
  return (
    <Section
      title="TV"
      path="/settings/tv"
      description="A read-only board of your turnovers for a TV at home. Open the private link in the TV's browser; it needs no sign-in and reloads itself every 5 minutes."
    >
      {async () => {
        const [{ tvLinkToken }, base] = await Promise.all([getSettings(await getDb()), appBaseUrl()]);
        const url = tvLinkToken ? tvLinkUrl(base, tvLinkToken) : null;
        return (
          <div className="max-w-3xl space-y-4">
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-medium">TV link</h3>
              {!url ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Make a private link for the TV. You become &ldquo;you&rdquo; on the board: the steps waiting on you show under Needs you.
                  </p>
                  <div className="mt-3">
                    <MakeTvLinkButton />
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">Open this link in the TV&apos;s browser:</p>
                  <div className="mt-2">
                    <CopyField label="TV link" value={url} />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Keep the link private: anyone who has it can see the board (units, stages and first names; no phone numbers, emails or notes),
                    though they can&apos;t change anything. If it&apos;s shared by mistake, make a new link: the old one stops working straight
                    away. The link&apos;s owner is whoever made it.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MakeTvLinkButton replace />
                    <TurnOffTvButton />
                  </div>
                </>
              )}
            </div>
          </div>
        );
      }}
    </Section>
  );
}
