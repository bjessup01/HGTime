"use client";

import { useState, useTransition } from "react";
import { createEmployee } from "@/lib/actions/admin";
import { Panel, Field, Button, inputClass, selectClass } from "@/components/ui";

type Schedule = { code: string; name: string };
type WorkCode = { code: string; description: string };

// Salaried and full-time hourly get holidays; the rest get sick time only.
// Derived by default, but the admin can override per employee.
const HOLIDAY_BY_TYPE: Record<string, boolean> = {
  salaried: true,
  full_time_hourly: true,
  part_time: false,
  on_call: false,
  seasonal: false,
};

export default function NewEmployeeForm({
  schedules,
  workCodes,
}: {
  schedules: Schedule[];
  workCodes: WorkCode[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { pin?: string; message?: string; error?: string } | null
  >(null);

  const [employeeType, setEmployeeType] = useState("full_time_hourly");
  const [payrollType, setPayrollType] = useState("semi_monthly");
  const [holidayEligible, setHolidayEligible] = useState(true);
  const [touchedHoliday, setTouchedHoliday] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  function onTypeChange(value: string) {
    setEmployeeType(value);
    // Salaried only exists on semi-monthly payroll.
    if (value === "salaried") setPayrollType("semi_monthly");
    if (!touchedHoliday) setHolidayEligible(HOLIDAY_BY_TYPE[value] ?? false);
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createEmployee(formData);
      if (res.ok) {
        setResult({ pin: res.pin, message: res.message });
      } else {
        setResult({ error: res.error });
      }
    });
  }

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Add employee</Button>
        {result?.pin && <PinNotice result={result} onDismiss={() => setResult(null)} />}
      </div>
    );
  }

  return (
    <>
      {result?.pin && <PinNotice result={result} onDismiss={() => setResult(null)} />}

      <Panel
        title="Add employee"
        actions={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      >
        <form action={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Employee number">
              <input name="employee_number" required inputMode="numeric" className={inputClass} />
            </Field>
            <Field label="First name">
              <input name="first_name" required className={inputClass} />
            </Field>
            <Field label="Last name">
              <input name="last_name" required className={inputClass} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Employee type">
              <select
                name="employee_type"
                value={employeeType}
                onChange={(e) => onTypeChange(e.target.value)}
                className={selectClass}
              >
                <option value="salaried">Salaried</option>
                <option value="full_time_hourly">Full-time hourly</option>
                <option value="part_time">Part-time</option>
                <option value="on_call">On-call</option>
                <option value="seasonal">Seasonal</option>
              </select>
            </Field>

            <Field
              label="Payroll"
              hint={employeeType === "salaried" ? "Salaried is semi-monthly only" : undefined}
            >
              <select
                name="payroll_type"
                value={payrollType}
                onChange={(e) => setPayrollType(e.target.value)}
                disabled={employeeType === "salaried"}
                className={selectClass}
              >
                <option value="semi_monthly">Semi-monthly</option>
                <option value="bi_weekly">Bi-weekly</option>
              </select>
            </Field>

            <Field label="Work schedule">
              <select name="schedule_code" defaultValue="5x8" className={selectClass}>
                {schedules.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Default work code">
              <select name="default_work_code" className={selectClass} defaultValue="">
                <option value="">— none —</option>
                {workCodes.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code} — {w.description}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hire date">
              <input type="date" name="hire_date" defaultValue={today} required className={inputClass} />
            </Field>
            <Field label="Role">
              <select name="role" defaultValue="employee" className={selectClass}>
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
                name="holiday_eligible"
                checked={holidayEligible}
                onChange={(e) => {
                  setHolidayEligible(e.target.checked);
                  setTouchedHoliday(true);
                }}
                className="h-4 w-4"
              />
              Holiday eligible
              <span className="text-xs text-[var(--muted)]">
                (also gets vacation; defaults from employee type)
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="shuttle_eligible" className="h-4 w-4" />
              Shuttle incentive eligible
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="can_enter_remotely" className="h-4 w-4" />
              May enter time off the company network
              <span className="text-xs text-[var(--muted)]">
                (unchecked = company network only)
              </span>
            </label>
          </div>

          {result?.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {result.error}
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create employee"}
          </Button>
        </form>
      </Panel>
    </>
  );
}

/** The generated PIN is shown once. It cannot be retrieved later. */
function PinNotice({
  result,
  onDismiss,
}: {
  result: { pin?: string; message?: string };
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-900">{result.message}</p>
          <p className="mt-2 text-sm text-emerald-800">
            PIN: <span className="font-mono text-lg font-semibold">{result.pin}</span>
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Write this down and give it to the employee — it will not be shown again.
            You can reset it later if needed.
          </p>
        </div>
        <Button variant="secondary" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}
