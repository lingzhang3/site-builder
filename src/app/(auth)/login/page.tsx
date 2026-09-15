"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction, type AuthFormState } from "../actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

const initialState: AuthFormState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Connect your data and build dashboards you can share.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>

        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">
        No account?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </Card>
  );
}
