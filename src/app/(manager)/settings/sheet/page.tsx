import { Download } from "lucide-react";
import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { getSettings } from "@/db/settings";
import { dateInZone } from "@/domain/dates";
import { appBaseUrl } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { sheetLinkUrl } from "@/server/queries/tracker-export";
import { Section } from "../section";
import { ImportForm } from "./import-form";
import { CopyField, MakeLinkButton, TurnOffButton } from "./sheet-link";

export const metadata: Metadata = { title: "Google Sheet" };

export default function SheetSettingsPage() {
  return (
    <Section
      title="Google Sheet"
      path="/settings/sheet"
      description="Bring your sheet's units into the app, download the Master Tracker, or have a tab in your Google Sheet keep itself up to date from the app."
    >
      {async () => {
        const [{ sheetLinkToken, timezone }, base] = await Promise.all([getSettings(await getDb()), appBaseUrl()]);
        const url = sheetLinkToken ? sheetLinkUrl(base, sheetLinkToken) : null;
        const local = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/.test(base);
        return (
          <div className="max-w-3xl space-y-4">
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-medium">Import from your sheet</h3>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Adds the units from your Master Tracker tab, with their statuses, dates, scope and notes. Units already in the app are left
                alone, and nobody is sent a message.
              </p>
              <ImportForm today={dateInZone(new Date(), timezone)} />
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-medium">Download</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Every unit as a spreadsheet file, with the same columns in the same places as your sheet&apos;s Master Tracker tab.
              </p>
              <a href="/api/tracker" className={`${buttonVariants({ variant: "secondary" })} mt-3`}>
                <Download aria-hidden /> Download the Master Tracker (CSV)
              </a>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-medium">Keep a Google Sheet up to date</h3>
              {!url ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Google Sheets can read the Master Tracker from the app by itself, about once an hour. Make a private link for it, then paste one
                    formula into your sheet.
                  </p>
                  <div className="mt-3">
                    <MakeLinkButton />
                  </div>
                </>
              ) : (
                <>
                  <ol className="mt-2 list-decimal space-y-3 pl-5 text-sm">
                    <li>In your Google Sheet, add a tab, for example &ldquo;From the app&rdquo;.</li>
                    <li>
                      Click cell A1 of that tab and paste this formula:
                      <div className="mt-2">
                        <CopyField label="Formula for Google Sheets" value={`=IMPORTDATA("${url}")`} />
                      </div>
                    </li>
                    <li>
                      The tab fills in and refreshes itself about once an hour. Its columns are where they are on your Master Tracker tab, so
                      formulas on other tabs (like Summary) can point at it instead.
                    </li>
                  </ol>
                  {local ? (
                    <p className="mt-3 rounded-md bg-st-progress-bg px-3 py-2 text-sm text-st-progress-fg">
                      Google can&apos;t reach the app on this computer. The link works once the app is on the internet (see the go-live guide).
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm text-muted-foreground">
                    Keep the link private: anyone who has it can see the tracker (units, statuses, notes and names), though they can&apos;t change
                    anything. If it&apos;s shared by mistake, make a new link: the old one stops working straight away.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MakeLinkButton replace />
                    <TurnOffButton />
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
