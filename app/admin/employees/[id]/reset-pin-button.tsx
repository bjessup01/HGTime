"use client";

import { useState, useTransition } from "react";
import { resetPin } from "@/lib/actions/admin";
import { Button } from "@/components/ui";

export default function ResetPinButton({ employeeId }: { employeeId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ pin?: string; error?: string } | null>(null);

  function onReset() {
    if (!confirm("Generate a new PIN? The current one stops working immediately.")) return;
    startTransition(async () => {
      const res = await resetPin(employeeId);
      setResult(res.ok ? { pin: res.pin } : { error: res.error });
    });
  }

  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={onReset} disabled={pending}>
        {pending ? "Resetting…" : "Reset PIN"}
      </Button>

      {result?.pin && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-800">
            New PIN:{" "}
            <span className="font-mono text-lg font-semibold">{result.pin}</span>
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Give this to the employee — it will not be shown again.
          </p>
        </div>
      )}

      {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
    </div>
  );
}
