import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentSession, safeNextPath } from "@/server/auth/current";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Unit Turnover</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Managers sign in here.</p>
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <Suspense fallback={<div className="h-56 animate-pulse rounded-md bg-muted" />}>
            <LoginContent searchParams={props.searchParams} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Inspectors, crews, cleaners, photographers and leasing staff don&apos;t need a password: they get a sign-in
          link by text or email.
        </p>
      </div>
    </main>
  );
}

async function LoginContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const session = await getCurrentSession();
  if (session?.person.roles.includes("admin")) redirect(next);
  return <LoginForm next={next} notice={params.denied ? "That page is for managers." : undefined} />;
}
