import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RequestLinkForm } from "./request-form";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, string> = {
  expired: "That link has expired. We can send you a new one.",
  revoked: "That link was turned off. Ask your manager for a new one.",
  inactive: "That link no longer works. Ask your manager.",
  unknown: "That link isn't valid. Check you opened the whole link, or get a new one below.",
};

export default function SignInPage(props: PageProps<"/signin">) {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">Unit Turnover</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Your tasks open from the link in your text or email.</p>
        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <Suspense fallback={<div className="h-48 animate-pulse rounded-md bg-muted" />}>
            <SignInContent searchParams={props.searchParams} />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Manager?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in with your password
          </Link>
        </p>
      </div>
    </main>
  );
}

async function SignInContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reason = typeof params.link === "string" ? params.link : undefined;
  const ref = typeof params.ref === "string" ? params.ref : undefined;
  const notice = params.signedOut ? "You're signed out on this device." : reason ? MESSAGES[reason] : undefined;
  return <RequestLinkForm notice={notice} expiredRef={reason === "expired" ? ref : undefined} />;
}
