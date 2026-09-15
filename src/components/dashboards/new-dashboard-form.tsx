"use client";

import { useActionState, useState } from "react";

import {
  createDashboardAction,
  type DashboardFormState,
} from "@/app/(app)/[orgSlug]/dashboards/actions";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/ui/modal";

const initialState: DashboardFormState = {};

export function NewDashboardForm({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createDashboardAction.bind(null, orgSlug),
    initialState,
  );

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New dashboard
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="New dashboard">
        <form action={formAction} className="space-y-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

          <Field label="Name">
            <Input name="name" required placeholder="Revenue overview" autoFocus />
          </Field>

          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
