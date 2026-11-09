"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/turnovers/new", label: "New turnover" },
  { href: "/tracker", label: "Master Tracker" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/" || (pathname.startsWith("/turnovers/") && !pathname.startsWith("/turnovers/new"))
      : pathname.startsWith(href);
  return (
    <nav
      aria-label="Main"
      className="order-last -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-1 overflow-x-auto border-t border-border px-1 py-1.5 text-sm md:order-none md:mx-0 md:w-auto md:border-t-0 md:p-0"
    >
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(link.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1.5 whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
            isActive(link.href) && "bg-muted font-medium text-foreground",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
