"use client";

import { Field, Input, Select } from "@/components/ui/form";
import { saveGeneralAction } from "../actions";
import { SaveButton, SettingsForm } from "../settings-form";

const ZONES: Array<[string, string]> = [
  ["America/Vancouver", "Pacific (Vancouver)"],
  ["America/Edmonton", "Mountain (Edmonton, Calgary)"],
  ["America/Regina", "Saskatchewan (Regina)"],
  ["America/Winnipeg", "Central (Winnipeg)"],
  ["America/Toronto", "Eastern (Toronto, Ottawa)"],
  ["America/Halifax", "Atlantic (Halifax, Moncton)"],
  ["America/St_Johns", "Newfoundland (St. John's)"],
  ["America/Los_Angeles", "Pacific (Los Angeles)"],
  ["America/Denver", "Mountain (Denver)"],
  ["America/Phoenix", "Arizona (Phoenix)"],
  ["America/Chicago", "Central (Chicago)"],
  ["America/New_York", "Eastern (New York)"],
];

export function GeneralForm({
  dueSoonDays,
  defaultTargetDays,
  timezone,
}: {
  dueSoonDays: number;
  defaultTargetDays: number | null;
  timezone: string;
}) {
  const zones = ZONES.some(([z]) => z === timezone) ? ZONES : [[timezone, timezone] as [string, string], ...ZONES];
  return (
    <SettingsForm action={saveGeneralAction} className="max-w-xl space-y-5 rounded-lg border border-border bg-card p-5">
      <Field
        label="Due-soon window (days)"
        htmlFor="dueSoonDays"
        hint="A unit is flagged Due soon when its target ready date is this many days away or fewer. Your sheet used 3."
      >
        <Input id="dueSoonDays" name="dueSoonDays" type="number" min={0} max={60} required defaultValue={dueSoonDays} className="w-28" />
      </Field>
      <Field
        label="Default target ready date (days after move-out)"
        htmlFor="defaultTargetDays"
        hint="New turnovers get this target unless you enter one. Leave blank for no default."
      >
        <Input id="defaultTargetDays" name="defaultTargetDays" type="number" min={1} max={365} defaultValue={defaultTargetDays ?? ""} className="w-28" />
      </Field>
      <Field label="Time zone" htmlFor="timezone" hint="Decides when 'today' starts for days vacant, due dates and reminders.">
        <Select id="timezone" name="timezone" defaultValue={timezone}>
          {zones.map(([zone, label]) => (
            <option key={zone} value={zone}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <SaveButton />
    </SettingsForm>
  );
}
