import Link from "next/link";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLinks, NavLinksFallback } from "./nav-links";
import { UserMenu } from "./user-menu";

export default function ManagerLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 px-4 sm:px-6 md:h-14 md:flex-nowrap">
          <Link href="/" className="flex h-12 shrink-0 items-center font-semibold tracking-tight md:h-auto">
            Unit Turnover
          </Link>
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
          </Suspense>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:order-none">
            <ThemeToggle />
            <Suspense fallback={<div className="h-8 w-20 animate-pulse rounded-md bg-muted" />}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </>
  );
}
