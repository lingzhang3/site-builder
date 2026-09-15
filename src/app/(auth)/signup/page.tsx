"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signupAction, type AuthFormState } from "../actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

const initialState: AuthFormState = {};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink">Create your workspace</h1>
      <p className="mt-1 text-sm text-ink-muted">
        You can invite the rest of your team later.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

        <Field label="Your name">
          <Input name="name" autoComplete="name" required autoFocus />
        </Field>

        <Field label="Workspace name" hint="Used in your URLs, e.g. /acme/dashboards">
          <Input name="orgName" autoComplete="organization" required />
        </Field>

        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>

        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>

        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending ? "Creating…" : "Create workspace"}
        </Button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
