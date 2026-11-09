import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { getNewTurnoverData } from "@/server/queries/new-turnover";
import { BulkForm } from "./bulk-form";
import { SingleForm } from "./single-form";

export const metadata: Metadata = { title: "New turnover" };

export default function NewTurnoverPage(props: PageProps<"/turnovers/new">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">New turnover</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The first step&apos;s person is told as soon as you save. Everyone else hears when it&apos;s their turn.
      </p>
      <Suspense fallback={<div className="mt-6 h-[36rem] animate-pulse rounded-lg bg-muted" />}>
        <NewTurnoverContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function NewTurnoverContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  await requireManager("/turnovers/new");
  await connection();
  const data = await getNewTurnoverData(await getDb());
  const bulk = params.mode === "bulk";
  const tab = (active: boolean) =>
    cn("rounded-md px-3 py-1.5 text-sm", active ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="mt-5">
      <div role="tablist" aria-label="How to add" className="mb-5 inline-flex rounded-lg bg-muted p-1">
        <Link role="tab" aria-selected={!bulk} href="/turnovers/new" className={tab(!bulk)}>
          One unit
        </Link>
        <Link role="tab" aria-selected={bulk} href="/turnovers/new?mode=bulk" className={tab(bulk)}>
          Paste a list
        </Link>
      </div>
      {data.properties.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm">
          Add your properties first, in{" "}
          <Link href="/settings/properties" className="font-medium text-primary hover:underline">
            Settings → Properties
          </Link>
          .
        </p>
      ) : bulk ? (
        <BulkForm data={data} />
      ) : (
        <SingleForm data={data} />
      )}
    </div>
  );
}
