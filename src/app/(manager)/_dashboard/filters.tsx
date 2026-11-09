"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/form";
import type { Dashboard, DashboardFilters } from "@/server/queries/dashboard";

export function Filters({
  options,
  current,
  view,
}: {
  options: Dashboard["options"];
  current: DashboardFilters;
  view: "board" | "list";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(current.q ?? "");

  const values: Record<string, string> = {
    property: current.property ?? "",
    assignee: current.assignee ?? "",
    stage: current.stage ?? "",
    flag: current.flag ?? "",
    q: current.q ?? "",
    complete: current.showComplete ? "1" : "",
    missing: current.missingMoveOut ? "moveout" : "",
    view: view === "list" ? "list" : "",
  };

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...values, ...changes })) if (v) next.set(k, v);
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  const active = Object.entries(values).some(([k, v]) => k !== "view" && v);

  return (
    <form
      role="search"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q: q.trim() });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== values.q && apply({ q: q.trim() })}
          placeholder="Find a unit"
          aria-label="Find a unit"
          className="w-44 pl-9"
        />
      </div>
      <Select aria-label="Property" value={values.property} onChange={(e) => apply({ property: e.target.value })} className="w-auto">
        <option value="">All properties</option>
        {options.properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Assigned to" value={values.assignee} onChange={(e) => apply({ assignee: e.target.value })} className="w-auto">
        <option value="">Anyone</option>
        <option value="none">Needs assignee</option>
        {options.assignees.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Stage" value={values.stage} onChange={(e) => apply({ stage: e.target.value })} className="w-auto">
        <option value="">All stages</option>
        {options.stages.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select aria-label="Flag" value={values.flag} onChange={(e) => apply({ flag: e.target.value })} className="w-auto">
        <option value="">All flags</option>
        {options.flags.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </Select>
      <label className="flex h-10 items-center gap-2 rounded-md px-2 text-sm">
        <input
          type="checkbox"
          checked={values.complete === "1"}
          onChange={(e) => apply({ complete: e.target.checked ? "1" : "" })}
          className="size-4 accent-primary"
        />
        Show completed
      </label>
      {active ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            apply({ property: "", assignee: "", stage: "", flag: "", q: "", complete: "", missing: "" });
          }}
          className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm text-primary hover:underline"
        >
          <X className="size-4" aria-hidden /> Clear
        </button>
      ) : null}
    </form>
  );
}
