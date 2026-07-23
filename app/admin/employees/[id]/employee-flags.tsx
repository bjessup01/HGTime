"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEmployeeFlags } from "@/lib/actions/admin";
import { Panel, Field, Button, inputClass, selectClass } from "@/components/ui";

export default function EmployeeFlags({ employee }: { employee: any }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await updateEmployeeFlags(formData);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  return (
    <Panel
      title="Details"
      description="Name, role, and permissions. Payroll type and schedule are effective-dated — change those through an assignment."
    >
      <form action={onSubmit} className="space-y-5">
        <input type="hidden" name="employee_id" value={employee.id} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="First name">
            <input
              name="first_name"
              defaultValue={employee.first_name}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Last name">
            <input
              name="last_name"
              defaultValue={employee.last_name}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Role">
            <select
              name="role"
              defaultValue={employee.role}
              className={selectClass}
            >
              <option value="employee">Employee</option>
              <option value="supervisor">Supervisor</option>
              <option value="payroll_admin">Payroll admin</option>
            </select>
          </Field>
        </div>

        <div className="space-y-2 rounded-md bg-[var(--bg)] p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="can_enter_remotely"
              defaultChecked={employee.can_enter_remotely}
              className="h-4 w-4"
            />
            May enter time off the company network
            <span className="text-xs text-[var(--muted)]">
              (unchecked = company computer or WiFi only)
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="shuttle_eligible"
              defaultChecked={employee.shuttle_eligible}
              className="h-4 w-4"
            />
            Shuttle incentive eligible
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {message?.ok && (
            <span className="text-sm text-emerald-700">{message.ok}</span>
          )}
          {message?.error && (
            <span className="text-sm text-red-700">{message.error}</span>
          )}
        </div>
      </form>
    </Panel>
  );
}
