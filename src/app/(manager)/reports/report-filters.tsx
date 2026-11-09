"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { REPORT_PERIODS, type ReportPeriod } from "@/domain/reports";
import { cn } from "@/lib/utils";

const href = (period: ReportPeriod, property: string | null) =>
  `/reports?${new URLSearchParams({ period, ...(property ? { property } : {}) })}`;

/** One row above everything it scopes: the period, the property, and the download. */
export function ReportFilters({
  period,
  property,
  properties,
}: {
  period: ReportPeriod;
  property: string | null;
  properties: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <nav aria-label="Period" className="flex flex-wrap gap-1">
        {(Object.keys(REPORT_PERIODS) as ReportPeriod[]).map((p) => (
          <Link
            key={p}
            href={href(p, property)}
            aria-current={p === period ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
              p === period && "bg-muted font-medium text-foreground",
            )}
          >
            {REPORT_PERIODS[p]}
          </Link>
        ))}
      </nav>
      <Select
        aria-label="Property"
        value={property ?? ""}
        onChange={(e) => router.push(href(period, e.target.value || null))}
        className="h-9 w-auto min-w-40"
      >
        <option value="">All properties</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <a
        href={`/api/reports/csv?${new URLSearchParams({ period, ...(property ? { property } : {}) })}`}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto")}
      >
        <Download aria-hidden /> Download CSV
      </a>
    </div>
  );
}
