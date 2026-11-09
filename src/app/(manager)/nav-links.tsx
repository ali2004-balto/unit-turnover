"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/turnovers/new", label: "New turnover" },
  { href: "/tracker", label: "Master Tracker" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

const NAV_CLASS =
  "order-last -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-1 overflow-x-auto border-t border-border px-1 py-1.5 text-sm md:order-none md:mx-0 md:w-auto md:border-t-0 md:p-0";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || (pathname.startsWith("/turnovers/") && !pathname.startsWith("/turnovers/new"));
  return pathname.startsWith(href);
}

function NavList({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className={NAV_CLASS}>
      {LINKS.map((link) => {
        const active = pathname !== null && isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Highlights the current page. Reads the URL, so it renders inside a Suspense boundary. */
export function NavLinks() {
  return <NavList pathname={usePathname()} />;
}

/** The same links without a highlight, shown while the URL is read. */
export function NavLinksFallback() {
  return <NavList pathname={null} />;
}
