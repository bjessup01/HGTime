"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signIn } from "@/lib/auth";
import { Button, Field, inputClass } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full py-3 text-base">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(signIn, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Timekeeping</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sign in with your employee number
          </p>
        </div>

        <form
          action={formAction}
          className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-6 shadow-sm"
        >
          <Field label="Employee number">
            <input
              name="employee_number"
              inputMode="numeric"
              autoComplete="username"
              autoFocus
              required
              className={inputClass}
            />
          </Field>

          <Field label="PIN">
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              maxLength={6}
              required
              className={inputClass + " tracking-[0.4em]"}
            />
          </Field>

          {state?.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </p>
          )}

          <SubmitButton />

          <p className="pt-2 text-center text-xs text-[var(--muted)]">
            Forgot your PIN? Contact payroll for a reset.
          </p>
        </form>
      </div>
    </main>
  );
}
