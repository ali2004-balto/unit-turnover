import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { DashboardContent } from "./_dashboard/dashboard-content";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage(props: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every unit turn, where it is, and who has it.</p>
        </div>
        <Link href="/turnovers/new" className={buttonVariants({ size: "lg" })}>
          New turnover
        </Link>
      </div>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-10 animate-pulse rounded-lg bg-muted" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}
