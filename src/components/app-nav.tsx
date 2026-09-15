"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const SECTIONS = [
  { segment: "dashboards", label: "Dashboards" },
  { segment: "datasets", label: "Datasets" },
  { segment: "connections", label: "Connections" },
] as const;

export function AppNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Sections">
      {SECTIONS.map(({ segment, label }) => {
        const href = `/${orgSlug}/${segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active ? "bg-surface-muted font-medium text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
