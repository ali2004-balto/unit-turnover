import { connection } from "next/server";
import { Suspense } from "react";
import { requireManager } from "@/server/auth/current";

/** A settings page: its heading, and content that loads after the manager check. */
export function Section({
  title,
  description,
  path,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  path: string;
  children: () => Promise<React.ReactNode>;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted" />}>
          <Guarded path={path}>{children}</Guarded>
        </Suspense>
      </div>
    </section>
  );
}

async function Guarded({ path, children }: { path: string; children: () => Promise<React.ReactNode> }) {
  await requireManager(path);
  await connection();
  return <>{await children()}</>;
}
