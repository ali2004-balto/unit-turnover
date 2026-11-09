import type { Metadata } from "next";
import { Suspense } from "react";
import { TurnoverContent } from "./turnover-content";

export const metadata: Metadata = { title: "Turnover" };

export default function TurnoverPage(props: PageProps<"/turnovers/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Suspense fallback={<TurnoverSkeleton />}>
        <TurnoverContent params={props.params} />
      </Suspense>
    </main>
  );
}

function TurnoverSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-24 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="h-[32rem] animate-pulse rounded-lg bg-muted" />
        <div className="h-[32rem] animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
