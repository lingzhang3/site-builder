"use client";

import { useActionState } from "react";

import {
  createDatasetAction,
  type DatasetFormState,
} from "@/app/(app)/[orgSlug]/datasets/actions";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

const initialState: DatasetFormState = {};

export function NewDatasetForm({
  orgSlug,
  connections,
}: {
  orgSlug: string;
  connections: { id: string; name: string; typeLabel: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    createDatasetAction.bind(null, orgSlug),
    initialState,
  );

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field label="Name">
        <Input name="name" required placeholder="Monthly recurring revenue" autoFocus />
      </Field>

      <Field label="Connection">
        <Select name="connectionId" required defaultValue={connections[0]?.id}>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} · {connection.typeLabel}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create and write the query"}
      </Button>
    </form>
  );
}
