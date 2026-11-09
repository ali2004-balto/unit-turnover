import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db";
import { needsSetup } from "@/server/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default function SetupPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Unit Turnover</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">First-time setup</p>
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-muted" />}>
            <SetupContent />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function SetupContent() {
  await connection();
  if (!(await needsSetup(await getDb()))) {
    return (
      <p className="text-sm">
        This app is already set up.{" "}
        <Link href="/login" className="text-primary underline underline-offset-2">
          Sign in
        </Link>
      </p>
    );
  }
  if (!process.env.SETUP_TOKEN?.trim()) {
    return (
      <p className="text-sm text-muted-foreground">
        To create the first manager, add a SETUP_TOKEN to the server&apos;s settings (any long random text), redeploy, then come back to this
        page.
      </p>
    );
  }
  return <SetupForm />;
}
