"use client";

import { useState, useTransition } from "react";

import {
  deleteConnectionAction,
  testConnectionAction,
} from "@/app/(app)/[orgSlug]/connections/actions";
import { Alert, Button } from "@/components/ui";
import { Modal } from "@/components/ui/modal";

export function ConnectionRowActions({
  orgSlug,
  connectionId,
  connectionName,
  datasetCount,
}: {
  orgSlug: string;
  connectionId: string;
  connectionName: string;
  datasetCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {message ? (
        <span className="max-w-xs">
          <Alert tone={message.tone}>{message.text}</Alert>
        </span>
      ) : null}

      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await testConnectionAction(orgSlug, connectionId);
            if (result.error) setMessage({ tone: "danger", text: result.error });
            else if (result.canWrite)
              setMessage({
                tone: "warning",
                text: `${result.notice ?? "Connected."} These credentials can write; prefer a read-only user.`,
              });
            else setMessage({ tone: "success", text: result.notice ?? "Connected." });
          })
        }
      >
        {pending ? "Testing…" : "Test"}
      </Button>

      <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
        Delete
      </Button>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${connectionName}?`}
        description="This does not touch your database — it only removes the connection here."
      >
        <div className="space-y-4">
          {datasetCount > 0 ? (
            <Alert tone="warning">
              {datasetCount} dataset{datasetCount === 1 ? "" : "s"} built on this connection will be
              deleted too. Widgets using them will show as unavailable.
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteConnectionAction(orgSlug, connectionId);
                  setConfirmingDelete(false);
                })
              }
            >
              {pending ? "Deleting…" : "Delete connection"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
