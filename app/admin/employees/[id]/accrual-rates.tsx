"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccrualRate, deleteAccrualRate } from "@/lib/actions/balances";
import { Panel, Button, Field, Empty, inputClass } from "@/components/ui";

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export default function AccrualRates({
  employeeId,
  rates,
}: {
  employeeId: string;
  rates: any[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  const current = rates[0];

  function onSave(formData: FormData) {
    startTransition(async () => {
      const res = await setAccrualRate(formData);
      if (res.ok) {
        setAdding(false);
        setMessage({ ok: res.message });
        router.refresh();
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  function onDelete(id: string) {
    if (!confirm("Remove this rate?")) return;
    startTransition(async () => {
      const res = await deleteAccrualRate(id);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  return (
    <Panel
      title="Accrual rates"
      description="Copied from the payroll system, which remains the source of truth. Used to cap what this employee may enter and to project their year-end balance."
      actions={
        !adding ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add rate
          </Button>
        ) : undefined
      }
    >
      {adding && (
        <form
          action={onSave}
          className="mb-5 space-y-4 rounded-md border border-[var(--line)] bg-[var(--bg)] p-4"
        >
          <input type="hidden" name="employee_id" value={employeeId} />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Effective from" hint="Usually an anniversary date">
              <input
                type="date"
                name="effective_from"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Vacation per period">
              <input
                name="vacation_per_period"
                type="number"
                step="0.01"
                min="0"
                defaultValue={current?.vacation_per_period ?? 0}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Sick per period">
              <input
                name="sick_per_period"
                type="number"
                step="0.01"
                min="0"
                defaultValue={current?.sick_per_period ?? 0}
                required
                className={inputClass}
              />
            </Field>
          </div>

          <input
            name="note"
            placeholder="Note (optional) — e.g. 5-year anniversary"
            className={inputClass + " text-sm"}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save rate"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setMessage(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rates.length === 0 ? (
        <Empty>
          No rate on file. Without one, this employee&rsquo;s cap falls back to
          their imported balance with no accrual added.
        </Empty>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2 pr-4 font-medium">Effective</th>
              <th className="py-2 pr-4 font-medium">Vacation</th>
              <th className="py-2 pr-4 font-medium">Sick</th>
              <th className="py-2 pr-4 font-medium">Note</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r: any, i: number) => (
              <tr
                key={r.id}
                className="border-b border-[var(--line)] last:border-0"
              >
                <td className="py-3 pr-4">
                  {fmt(r.effective_from)}
                  {i === 0 && (
                    <span className="ml-2 text-xs text-emerald-700">current</span>
                  )}
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {Number(r.vacation_per_period)}h
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {Number(r.sick_per_period)}h
                </td>
                <td className="py-3 pr-4 text-[var(--muted)]">{r.note ?? "—"}</td>
                <td className="py-3">
                  <button
                    onClick={() => onDelete(r.id)}
                    disabled={pending}
                    className="text-sm text-red-600 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message?.ok && (
        <p className="mt-3 text-sm text-emerald-700">{message.ok}</p>
      )}
      {message?.error && (
        <p className="mt-3 text-sm text-red-700">{message.error}</p>
      )}
    </Panel>
  );
}
