"use client";

import { useState, useTransition } from "react";

import {
  publishDashboardAction,
  revokePublicationAction,
} from "@/app/(app)/[orgSlug]/dashboards/actions";
import { Alert, Button, Input } from "@/components/ui";
import { Modal } from "@/components/ui/modal";

export function PublishButton({
  orgSlug,
  dashboardId,
  publication,
}: {
  orgSlug: string;
  dashboardId: string;
  publication: { token: string; createdAt: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(publication?.token ?? null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // Built in the browser so the link matches whatever host the app is served
  // on, without needing a configured base URL.
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/p/${token}` : null;

  const publish = () =>
    startTransition(async () => {
      setError(null);
      const result = await publishDashboardAction(orgSlug, dashboardId);
      if (result.error) setError(result.error);
      else setToken(result.token ?? null);
    });

  const revoke = () =>
    startTransition(async () => {
      setError(null);
      const result = await revokePublicationAction(orgSlug, dashboardId);
      if (result.error) setError(result.error);
      else setToken(null);
    });

  return (
    <>
      <Button variant={token ? "secondary" : "primary"} size="sm" onClick={() => setOpen(true)}>
        {token ? "Shared" : "Share"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Share this dashboard"
        description="Anyone with the link can view it — no sign-in required."
      >
        <div className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {token && url ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(url).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <Alert tone="warning" title="This link is the credential.">
                Anyone who has it sees live results from your connected databases. It does not
                expose your SQL or your connection details, and results are cached briefly rather
                than re-queried on every visit.
              </Alert>

              <div className="flex justify-between gap-2">
                <Button variant="danger" onClick={revoke} disabled={pending}>
                  {pending ? "Revoking…" : "Revoke link"}
                </Button>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                Publishing creates an unguessable link that renders this dashboard for anyone who
                opens it. You can revoke it at any time.
              </p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={publish} disabled={pending}>
                  {pending ? "Creating…" : "Create link"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
