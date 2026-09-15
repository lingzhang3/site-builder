"use client";

import { useActionState, useState } from "react";

import {
  createConnectionAction,
  type ConnectionFormState,
} from "@/app/(app)/[orgSlug]/connections/actions";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/ui/modal";

const DEFAULT_PORTS = { postgres: 5432, mysql: 3306 } as const;
type ConnectionType = keyof typeof DEFAULT_PORTS;

const initialState: ConnectionFormState = {};

export function AddConnectionButton({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add connection
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Connect a database"
        description="We connect read-only. Give us a user that cannot modify data."
      >
        <ConnectionForm orgSlug={orgSlug} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function ConnectionForm({ orgSlug, onDone }: { orgSlug: string; onDone: () => void }) {
  const [type, setType] = useState<ConnectionType>("postgres");
  const [state, formAction, pending] = useActionState(
    createConnectionAction.bind(null, orgSlug),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {state.ok ? (
        <Alert tone={state.canWrite ? "warning" : "success"}>
          {state.notice}
          {state.canWrite ? (
            <p className="mt-1">
              These credentials can modify data. Queries here are always read-only, but a
              read-only database user is a safer setup.
            </p>
          ) : null}
        </Alert>
      ) : null}

      <Field label="Name" hint="How this appears in dataset pickers.">
        <Input name="name" required placeholder="Production analytics" autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Engine">
          <Select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as ConnectionType)}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </Select>
        </Field>

        <Field label="Port">
          {/* key forces a remount so the default updates when the engine changes
              without discarding a port the user typed themselves. */}
          <Input
            key={type}
            name="port"
            type="number"
            min={1}
            max={65535}
            defaultValue={DEFAULT_PORTS[type]}
            required
          />
        </Field>
      </div>

      <Field label="Host">
        <Input name="host" required placeholder="db.example.com" autoComplete="off" />
      </Field>

      <Field label="Database">
        <Input name="database" required placeholder="analytics" autoComplete="off" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="User">
          <Input name="user" required placeholder="readonly" autoComplete="off" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="new-password" />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" name="ssl" defaultChecked className="size-4 accent-accent" />
        Connect over TLS
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button onClick={onDone} disabled={pending}>
          {state.ok ? "Done" : "Cancel"}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Testing…" : "Test and save"}
        </Button>
      </div>

      <p className="text-xs text-ink-subtle">
        The password is encrypted before it is stored and is never sent back to the browser.
      </p>
    </form>
  );
}
