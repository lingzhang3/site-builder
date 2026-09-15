"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function OrgSwitcher({
  current,
  orgs,
}: {
  current: string;
  orgs: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Switch workspace"
      className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-ink disabled:opacity-60"
      value={current}
      disabled={pending}
      onChange={(event) => {
        const slug = event.target.value;
        if (slug === current) return;
        startTransition(() => router.push(`/${slug}`));
      }}
    >
      {orgs.map((org) => (
        <option key={org.slug} value={org.slug}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
