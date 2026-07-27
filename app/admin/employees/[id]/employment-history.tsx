"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  terminateEmployee,
  undoTermination,
  rehireEmployee,
} from "@/lib/actions/admin";
import { Panel, Button, Badge, Field, inputClass, selectClass } from "@/components/ui";

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export default function EmploymentHistory({
  employeeId,
  periods,
  active,
  schedules,
  workCodes,
}: {
  employeeId: string;
  periods: any[];
  active: boolean;
  schedules: any[];
  workCodes: any[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "terminate" | "rehire">("none");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  const open = periods.find((p: any) => p.is_current);
  const pendingTerm = periods.find((p: any) => p.is_future_termination);
  const lastEnd = periods.find((p: any) => p.end_date)?.end_date;

  function run(action: (fd: FormData) => Promise<any>, formData: FormData) {
    startTransition(async () => {
      const res = await action(formData);
      if (res.ok) {
        setMode("none");
        setMessage({ ok: res.message });
        router.refresh();
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  function onUndo() {
    if (!confirm("Undo this termination and reactivate the login?")) return;
    startTransition(async () => {
      const res = await undoTermination(employeeId);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  return (
    <Panel
      title="Employment"
      description="Hire dates, terminations, and rehires. Seniority runs from the earliest hire date."
      actions={
        mode === "none" ? (
          open ? (
            <Button variant="secondary" onClick={() => setMode("terminate")}>
              Terminate
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setMode("rehire")}>
              Rehire
            </Button>
          )
        ) : undefined
      }
    >
      {pendingTerm && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Termination scheduled for {fmt(pendingTerm.end_date)}. The login stays
            active until then.
          </p>
          <button
            onClick={onUndo}
            disabled={pending}
            className="mt-1 text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}

      {mode === "terminate" && (
        <form
          action={(fd) => run(terminateEmployee, fd)}
          className="mb-5 space-y-4 rounded-md border border-[var(--line)] bg-[var(--bg)] p-4"
        >
          <input type="hidden" name="employee_id" value={employeeId} />

          <p className="text-sm text-[var(--muted)]">
            Sets the last day worked and deactivates the login. A future date
            leaves them working until it arrives. Open timecards stay editable so
            a supervisor can finish and approve the final card.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div className="w-44">
              <Field label="Last day worked">
                <input
                  type="date"
                  name="term_date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="min-w-[14rem] flex-1">
              <Field label="Reason (optional)">
                <input name="term_reason" className={inputClass} />
              </Field>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Saving…" : "Record termination"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setMode("none");
                setMessage(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "rehire" && (
        <form
          action={(fd) => run(rehireEmployee, fd)}
          className="mb-5 space-y-4 rounded-md border border-[var(--line)] bg-[var(--bg)] p-4"
        >
          <input type="hidden" name="employee_id" value={employeeId} />

          <p className="text-sm text-[var(--muted)]">
            Opens a new employment period, reactivates the login, and creates an
            assignment effective from the hire date. Add an accrual rate
            afterward — vacation accrual runs from the new hire date, not the
            original.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Hire date"
              hint={lastEnd ? `Must be after ${fmt(lastEnd)}` : undefined}
            >
              <input
                type="date"
                name="hire_date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
                className={inputClass}
              />
            </Field>

            <Field label="Payroll">
              <select name="payroll_type" defaultValue="semi_monthly" className={selectClass}>
                <option value="semi_monthly">Semi-monthly</option>
                <option value="bi_weekly">Bi-weekly</option>
              </select>
            </Field>

            <Field label="Employee type">
              <select
                name="employee_type"
                defaultValue="seasonal"
                className={selectClass}
              >
                <option value="salaried">Salaried</option>
                <option value="full_time_hourly">Full-time hourly</option>
                <option value="part_time">Part-time</option>
                <option value="on_call">On call</option>
                <option value="seasonal">Seasonal</option>
              </select>
            </Field>

            <Field label="Schedule">
              <select name="schedule_code" defaultValue="5x8" className={selectClass}>
                {schedules.map((s: any) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Default work code">
              <select name="default_work_code" defaultValue="" className={selectClass}>
                <option value="">None</option>
                {workCodes.map((c: any) => (
                  <option key={c.id} value={c.code}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex items-end pb-2.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="holiday_eligible" className="h-4 w-4" />
                Holiday eligible
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Rehire"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setMode("none");
                setMessage(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {periods.map((p: any) => (
          <div
            key={p.id}
            className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${
              p.is_current
                ? "border-emerald-200 bg-emerald-50/30"
                : "border-[var(--line)]"
            }`}
          >
            <span className="text-sm font-medium">
              {fmt(p.start_date)} – {p.end_date ? fmt(p.end_date) : "present"}
            </span>

            {p.is_current && <Badge tone="good">Active</Badge>}
            {p.is_future_termination && <Badge tone="warn">Ending</Badge>}

            <span className="text-sm text-[var(--muted)]">
              {p.days_worked} days
            </span>

            {p.note && (
              <span className="text-sm italic text-[var(--muted)]">{p.note}</span>
            )}

            {p.end_date && !p.is_future_termination && (
              <button
                onClick={onUndo}
                disabled={pending}
                className="ml-auto text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
              >
                Undo termination
              </button>
            )}
          </div>
        ))}
      </div>

      {message?.ok && <p className="mt-3 text-sm text-emerald-700">{message.ok}</p>}
      {message?.error && (
        <p className="mt-3 text-sm text-red-700">{message.error}</p>
      )}
    </Panel>
  );
}
