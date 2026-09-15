import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicDashboard } from "@/components/dashboards/public-dashboard";
import { loadPublicDashboard } from "@/lib/publications";

export const metadata: Metadata = {
  // A share link is a secret. Keeping it out of search indexes is part of that.
  robots: { index: false, follow: false },
};

export default async function PublicDashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadPublicDashboard(token);

  // Unknown, revoked and expired tokens all render the same 404, so the page
  // cannot be used to probe which links ever existed.
  if (!view) notFound();

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-2 px-4 py-4">
          <h1 className="text-base font-semibold text-ink">{view.name}</h1>
          <p className="text-xs text-ink-subtle">
            Data as of{" "}
            <time dateTime={view.generatedAt}>
              {new Date(view.generatedAt).toLocaleString()}
            </time>
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-2 py-4">
        <PublicDashboard layout={view.layout} widgets={view.widgets} />
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2">
        <p className="text-xs text-ink-subtle">Built with Site Builder</p>
      </footer>
    </div>
  );
}
