import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { TrackerContent } from "./tracker-content";

export const metadata: Metadata = { title: "Master Tracker" };

export default function TrackerPage(props: PageProps<"/tracker">) {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight">Master Tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The same columns as your sheet, with every grey column calculated by the app&apos;s formulas. Read-only: use
            it to check the app against your sheet, or{" "}
            <Link href="/settings/sheet" className="text-primary underline underline-offset-2">
              keep a Google Sheet up to date
            </Link>
            .
          </p>
        </div>
        <a href="/api/tracker" className={buttonVariants({ variant: "secondary" })}>
          <Download aria-hidden /> Download CSV
        </a>
      </div>
      <Suspense fallback={<TrackerSkeleton />}>
        <TrackerContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

function TrackerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="h-10 w-72 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
