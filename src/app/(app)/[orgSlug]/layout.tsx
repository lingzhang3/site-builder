import Link from "next/link";

import { logoutAction } from "@/app/(auth)/actions";
import { AppNav } from "@/components/app-nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { Button } from "@/components/ui";
import { listMyOrgs, requireOrgBySlug } from "@/lib/rbac";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  // Redirects to /login when signed out, 404s when not a member. Every page
  // under this layout can therefore assume a valid, authorized org context.
  const { org, role } = await requireOrgBySlug(orgSlug);
  const orgs = await listMyOrgs();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href={`/${org.slug}`} className="text-sm font-semibold text-ink">
            Site Builder
          </Link>

          <AppNav orgSlug={org.slug} />

          <div className="ml-auto flex items-center gap-3">
            {orgs.length > 1 ? (
              <OrgSwitcher
                current={org.slug}
                orgs={orgs.map(({ org: candidate }) => ({
                  slug: candidate.slug,
                  name: candidate.name,
                }))}
              />
            ) : null}

            <span className="hidden text-xs text-ink-subtle sm:inline">{role}</span>

            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
