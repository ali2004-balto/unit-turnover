import type { Metadata } from "next";
import { getSettings } from "@/db/settings";
import { getDb } from "@/server/db";
import { Section } from "../section";
import { GeneralForm } from "./general-form";

export const metadata: Metadata = { title: "Settings" };

export default function GeneralSettingsPage() {
  return (
    <Section title="General" path="/settings/general" description="The settings from your sheet's Setup tab, plus the app's time zone.">
      {async () => {
        const settings = await getSettings(await getDb());
        return (
          <GeneralForm
            dueSoonDays={settings.dueSoonDays}
            defaultTargetDays={settings.defaultTargetDays}
            timezone={settings.timezone}
          />
        );
      }}
    </Section>
  );
}
