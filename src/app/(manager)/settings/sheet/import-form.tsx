"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { importAction, type ImportState } from "./import-actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LIMIT = 15;

function Listed({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
        {items.slice(0, LIMIT).map((item, i) => (
          <li key={i}>{item}</li>
        ))}
        {items.length > LIMIT ? <li>and {items.length - LIMIT} more</li> : null}
      </ul>
    </div>
  );
}

function Details({ state }: { state: ImportState }) {
  const r = state.report!;
  return (
    <div className="space-y-3">
      <Listed title="New properties" items={r.newProperties} />
      <Listed title="New in-house employees (from “Assigned to”)" items={r.newPeople} />
      <Listed title="Already in the app, so left alone" items={r.skipped.map((s) => `Row ${s.rowNumber}: ${s.reason}`)} />
      <Listed title="Worth a look" items={r.warnings.map((w) => `Row ${w.rowNumber}, ${w.column}: ${w.message}`)} />
    </div>
  );
}

/** Upload an export of the sheet, see what it would do, then import it. */
export function ImportForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, { step: "choose" });

  if (state.step === "done") {
    const r = state.report!;
    return (
      <div className="space-y-3" role="status">
        <p className="font-medium">
          Imported {plural(r.created, "unit")} from {state.fileName}. Nobody was sent a message.
        </p>
        {r.newPeople.length ? (
          <p className="text-sm text-muted-foreground">
            Add phone numbers for the new in-house employees in{" "}
            <Link href="/settings/people" className="text-primary underline underline-offset-2">
              Settings, People
            </Link>
            , so they get their tasks.
          </p>
        ) : null}
        <Details state={state} />
        <div className="flex flex-wrap gap-2">
          <Link href="/" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            Go to the dashboard
          </Link>
          <form action={action}>
            <input type="hidden" name="mode" value="reset" />
            <Button type="submit" variant="ghost">
              Import another file
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (state.step === "preview") {
    const r = state.report!;
    return (
      <div className="space-y-4">
        <p className="font-medium">
          {state.fileName}: {plural(state.found!, "unit")} found.{" "}
          {r.created > 0 ? `${plural(r.created, "unit")} will be added` : "Nothing new to add"}
          {r.skipped.length ? `; ${r.skipped.length} already in the app` : ""}.
        </p>
        <Details state={state} />
        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="mode" value="import" />
            <input type="hidden" name="csv" value={state.csv} />
            <input type="hidden" name="fileName" value={state.fileName} />
            <input type="hidden" name="exportedOn" value={state.exportedOn} />
            <Button type="submit" disabled={pending || r.created === 0}>
              {pending ? "Importing…" : `Import ${plural(r.created, "unit")}`}
            </Button>
          </form>
          <form action={action}>
            <input type="hidden" name="mode" value="reset" />
            <Button type="submit" variant="secondary" disabled={pending}>
              Choose another file
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mode" value="preview" />
      <Field label="The CSV file" htmlFor="import-file" hint="In Google Sheets, open the Master Tracker tab, then File, Download, Comma-separated values (.csv).">
        <Input id="import-file" name="file" type="file" accept=".csv,text/csv" required />
      </Field>
      <Field label="Downloaded on" htmlFor="import-date" hint="So notes like “Sat Nov 14” get the right year.">
        <Input id="import-date" name="exportedOn" type="date" defaultValue={today} className="w-44" />
      </Field>
      <FormError message={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Reading the file…" : "Check the file"}
      </Button>
      <p className="text-xs text-muted-foreground">Nothing changes until you see what it will do and press Import.</p>
    </form>
  );
}
