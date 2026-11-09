import Link from "next/link";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { TaskUserMenu } from "./task-user-menu";

/** The assignee side: a plain header and one column, built for a phone held in one hand. */
export default function TasksLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
          <Link href="/tasks" className="font-semibold tracking-tight">
            Unit Turnover
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Suspense fallback={null}>
              <TaskUserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-32">{children}</main>
    </>
  );
}
