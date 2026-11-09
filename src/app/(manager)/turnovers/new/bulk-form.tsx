"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { parseBulk } from "@/domain/bulk";
import { formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NewTurnoverData } from "@/server/queries/new-turnover";
import { bulkCreateAction, type CreateState } from "./actions";

const EXAMPLE = `Acadian 203
Balwin 1-6, Nov 2
Parkdale, 405, 2026-11-02, 2026-11-12`;

export function BulkForm({ data }: { data: NewTurnoverData }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(bulkCreateAction, {});
  const [text, setText] = useState("");
  const [moveOut, setMoveOut] = useState("");
  const activeUnits = useMemo(() => new Set(data.activeUnits), [data.activeUnits]);
  const rows = useMemo(
    () => parseBulk(text, data.properties, { today: data.today, defaultMoveOut: moveOut || null, activeUnits }),
    [text, moveOut, data.properties, data.today, activeUnits],
  );
  const ready = rows.filter((r) => !r.error && !r.warning);
  const problems = rows.filter((r) => r.error).length;
  const skipped = rows.filter((r) => !r.error && r.warning).length;

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <div className="rounded-lg border border-border bg-card p-4">
        <Field
          label="Units, one per line"
          htmlFor="bulk"
          hint="Property and unit, then optionally move-out and target dates. Ranges like Balwin 1-6 work, and so does pasting rows from a spreadsheet."
        >
          <Textarea
            id="bulk"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            className="min-h-40 font-mono text-sm"
            spellCheck={false}
          />
        </Field>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Move-out date for lines without one" htmlFor="defaultMoveOut" hint="Optional.">
            <Input id="defaultMoveOut" type="date" value={moveOut} onChange={(e) => setMoveOut(e.target.value)} />
          </Field>
          {data.templates.length > 1 ? (
            <Field label="Workflow" htmlFor="templateId">
              <Select id="templateId" name="templateId" defaultValue={data.templates[0].id}>
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="px-4 pt-3 text-left text-sm font-semibold">
              Preview: {ready.length} to create
              {problems ? `, ${problems} with problems` : ""}
              {skipped ? `, ${skipped} skipped` : ""}
            </caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium">Move-out</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.line}-${r.unit}-${i}`} className="border-t border-border">
                  <td className="px-4 py-1.5">{r.propertyName ?? <span className="text-muted-foreground">{r.text}</span>}</td>
                  <td className="px-4 py-1.5 tabular-nums">{r.unit}</td>
                  <td className="px-4 py-1.5">{formatMonthDay(r.moveOutDate) || "–"}</td>
                  <td className="px-4 py-1.5">
                    {r.targetReadyDate
                      ? formatMonthDay(r.targetReadyDate)
                      : r.moveOutDate && data.defaultTargetDays !== null
                        ? `Default (+${data.defaultTargetDays} days)`
                        : "–"}
                  </td>
                  <td className={cn("px-4 py-1.5", r.error ? "text-danger" : r.warning ? "text-warning" : "text-st-done-fg")}>
                    {r.error ?? (r.warning ? `${r.warning}: skipped` : "OK")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <input
        type="hidden"
        name="rows"
        value={JSON.stringify(
          ready.map((r) => ({
            propertyId: r.propertyId,
            unit: r.unit,
            moveOutDate: r.moveOutDate,
            ...(r.targetReadyDate ? { targetReadyDate: r.targetReadyDate } : {}),
          })),
        )}
      />
      <div className="flex items-center justify-end gap-3">
        {problems > 0 ? <p className="text-sm text-danger">Fix or remove the lines with problems first.</p> : null}
        <Button type="submit" size="lg" disabled={pending || ready.length === 0 || problems > 0}>
          {pending ? "Creating…" : `Create ${ready.length || ""} turnover${ready.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </form>
  );
}
