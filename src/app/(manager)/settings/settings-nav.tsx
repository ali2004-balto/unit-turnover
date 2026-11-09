"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/properties", label: "Properties" },
  { href: "/settings/people", label: "People" },
  { href: "/settings/defaults", label: "Default assignees" },
  { href: "/settings/templates", label: "Workflows" },
  { href: "/settings/messages", label: "Messages" },
];

function Nav({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col">
      {SECTIONS.map((s) => {
        const active = pathname?.startsWith(s.href) ?? false;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsNav() {
  return <Nav pathname={usePathname()} />;
}

export function SettingsNavFallback() {
  return <Nav pathname={null} />;
}
