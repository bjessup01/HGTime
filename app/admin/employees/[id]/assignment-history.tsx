"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addAssignment,
  correctAssignment,
  removeAssignment,
} from "@/lib/actions/admin";
import {
  Panel,
  Button,
  Badge,
  Field,
  Empty,
  inputClass,
  selectClass,
} from "@/components/ui";

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** Fields where a change alters how past days compute. */
const STRUCTURAL = ["payroll_type", "employee_type", "schedule_code"];

export default function AssignmentHistory({
  employeeId,
  assignments,
  workCodes,
  schedules,
  nextPeriodStart,
}: any) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "add" | string>("none");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );
  const [warning, setWarning] = useState<string | null>(null);

  const current = assignments.find((a: any) => a.is_current);

  function onAdd(formData: FormData) {
    startTransition(async () => {
      const res = await addAssignment(formData);
      if (res.ok) {
        setMode("none");
        setMessage({ ok: res.message });
        router.refresh();
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  function onCorrect(formData: FormData) {
    startTransition(async () => {
      const res = await correctAssignment(formData);
      if (res.ok) {
        setMode("none");
        setWarning(null);
        setMessage({ ok: res.message });
        router.refresh();
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  function onRemove(id: string) {
    if (!confirm("Remove this assignment row?")) return;
    startTransition(async () => {
      const res = await removeAssignment(id);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  /** Warn when a correction touches something structural. */
  function checkStructural(row: any, formEl: HTMLFormElement) {
    const fd = new FormData(formEl);
    const changed = STRUCTURAL.filter(
      (f) => String(fd.get(f) ?? "") !== String(row[f] ?? "")
    );

    if (changed.length === 0) return null;

    const names: Record<string, string> = {
      payroll_type: "payroll type",
      employee_type: "employee type",
      schedule_code: "schedule",
    };

    return (
      `Changing the ${changed.map((c) => names[c]).join(" and ")} affects how ` +
      `days are computed` +
      (row.has_timecards
        ? `, and ${row.timecard_count} timecard${
            row.timecard_count === 1 ? "" : "s"
          } already exist under this row.`
        : ".") +
      ` Correct this row only if the old value was a mistake — otherwise add a ` +
      `new assignment so the history keeps both.`
    );
  }

  return (
    <Panel
      title="Assignment history"
      description="Payroll type, employee type, schedule, and default work code, effective from a date."
      actions={
        mode === "none" ? (
          <Button variant="secondary" onClick={() => setMode("add")}>
            Add assignment
          </Button>
        ) : undefined
      }
    >
      {mode === "add" && (
        <form
          action={onAdd}
          className="mb-5 space-y-4 rounded-md border border-[var(--line)] bg-[var(--bg)] p-4"
        >
          <input type="hidden" name="employee_id" value={employeeId} />

          <p className="text-sm text-[var(--muted)]">
            Records a change from a date. The current assignment stays in the
            history and continues to apply to days before this one.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Effective from"
              hint="Defaults to the next period start"
            >
              <input
                type="date"
                name="effective_from"
                defaultValue={nextPeriodStart}
                required
                className={inputClass}
              />
            </Field>

            <Field label="Payroll">
              <select
                name="payroll_type"
                defaultValue={current?.payroll_type ?? "semi_monthly"}
                className={selectClass}
              >
                <option value="semi_monthly">Semi-monthly</option>
                <option value="bi_weekly">Bi-weekly</option>
              </select>
            </Field>

            <Field label="Employee type">
              <select
                name="employee_type"
                defaultValue={current?.employee_type ?? "full_time_hourly"}
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
              <select
                name="schedule_code"
                defaultValue={current?.schedule_code ?? "5x8"}
                className={selectClass}
              >
                {schedules.map((s: any) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Default work code">
              <select
                name="default_work_code"
                defaultValue={current?.default_work_code ?? ""}
                className={selectClass}
              >
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
                <input
                  type="checkbox"
                  name="holiday_eligible"
                  defaultChecked={current?.holiday_eligible ?? true}
                  className="h-4 w-4"
                />
                Holiday eligible
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add assignment"}
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

      {assignments.length === 0 ? (
        <Empty>No assignments on file.</Empty>
      ) : (
        <div className="space-y-2">
          {assignments.map((a: any) =>
            mode === a.id ? (
              <form
                key={a.id}
                action={onCorrect}
                onChange={(e) =>
                  setWarning(checkStructural(a, e.currentTarget as HTMLFormElement))
                }
                className="space-y-4 rounded-md border border-[var(--accent)] bg-white p-4"
              >
                <input type="hidden" name="assignment_id" value={a.id} />

                <p className="text-sm font-medium">Correct this assignment</p>
                <p className="text-sm text-[var(--muted)]">
                  Treats the row as always having said this. Use &ldquo;Add
                  assignment&rdquo; instead when something genuinely changed.
                </p>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Effective from">
                    <input
                      type="date"
                      name="effective_from"
                      defaultValue={a.effective_from}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Payroll">
                    <select
                      name="payroll_type"
                      defaultValue={a.payroll_type}
                      className={selectClass}
                    >
                      <option value="semi_monthly">Semi-monthly</option>
                      <option value="bi_weekly">Bi-weekly</option>
                    </select>
                  </Field>

                  <Field label="Employee type">
                    <select
                      name="employee_type"
                      defaultValue={a.employee_type}
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
                    <select
                      name="schedule_code"
                      defaultValue={a.schedule_code}
                      className={selectClass}
                    >
                      {schedules.map((s: any) => (
                        <option key={s.code} value={s.code}>
                          {s.code} — {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Default work code">
                    <select
                      name="default_work_code"
                      defaultValue={a.default_work_code ?? ""}
                      className={selectClass}
                    >
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
                      <input
                        type="checkbox"
                        name="holiday_eligible"
                        defaultChecked={a.holiday_eligible}
                        className="h-4 w-4"
                      />
                      Holiday eligible
                    </label>
                  </div>
                </div>

                {warning && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-900">{warning}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Correct this row"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setMode("none");
                      setWarning(null);
                      setMessage(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div
                key={a.id}
                className={`rounded-md border p-3 ${
                  a.is_current
                    ? "border-emerald-200 bg-emerald-50/30"
                    : "border-[var(--line)]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">
                    {fmt(a.effective_from)} – {a.effective_to ? fmt(a.effective_to) : "present"}
                  </span>

                  {a.is_current && <Badge tone="good">Current</Badge>}

                  <span className="text-sm text-[var(--muted)]">
                    {a.employee_type?.replace(/_/g, " ")} ·{" "}
                    {a.payroll_type === "semi_monthly" ? "semi-monthly" : "bi-weekly"} ·{" "}
                    {a.schedule_code}
                    {a.default_work_code && ` · ${a.default_work_code}`}
                    {!a.holiday_eligible && " · no holidays"}
                  </span>

                  {a.has_timecards && (
                    <span className="text-xs text-[var(--muted)]">
                      {a.timecard_count} timecard
                      {a.timecard_count === 1 ? "" : "s"}
                    </span>
                  )}

                  <div className="ml-auto flex gap-3">
                    <button
                      onClick={() => {
                        setMode(a.id);
                        setWarning(null);
                      }}
                      className="text-sm text-[var(--accent)] hover:underline"
                    >
                      Correct
                    </button>
                    {assignments.length > 1 && (
                      <button
                        onClick={() => onRemove(a.id)}
                        disabled={pending}
                        className="text-sm text-red-600 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {message?.ok && <p className="mt-3 text-sm text-emerald-700">{message.ok}</p>}
      {message?.error && (
        <p className="mt-3 text-sm text-red-700">{message.error}</p>
      )}
    </Panel>
  );
}
