"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importBalances, setBalance } from "@/lib/actions/balances";
import { Panel, Field, Button, inputClass, selectClass } from "@/components/ui";

export default function BalanceTools() {
  const router = useRouter();
  const [tab, setTab] = useState<"import" | "manual">("import");
  const [pending, startTransition] = useTransition();
  const [csv, setCsv] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<{ ok?: string; errors?: string[]; error?: string } | null>(
    null
  );

  function onImport() {
    if (!csv.trim()) {
      setResult({ error: "Paste some rows first." });
      return;
    }
    startTransition(async () => {
      const res = await importBalances(csv, asOf);
      if (!res.ok) {
        setResult({ error: res.error });
      } else {
        setResult({
          ok: `Imported ${res.imported} balance${res.imported === 1 ? "" : "s"}.`,
          errors: res.errors,
        });
        if (res.errors.length === 0) setCsv("");
        router.refresh();
      }
    });
  }

  function onManual(formData: FormData) {
    startTransition(async () => {
      const res = await setBalance(formData);
      setResult(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  return (
    <Panel
      title="Update balances"
      actions={
        <div className="flex gap-2">
          <button
            onClick={() => setTab("import")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === "import"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)] bg-white"
            }`}
          >
            Import
          </button>
          <button
            onClick={() => setTab("manual")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === "manual"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)] bg-white"
            }`}
          >
            Single correction
          </button>
        </div>
      }
    >
      {tab === "import" ? (
        <div className="space-y-4">
          <div className="w-48">
            <Field label="Balances as of" hint="Usually the pay period end date">
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="Paste rows"
            hint="employee_number, vacation, sick — one per line. A header row is skipped automatically. Leave a cell blank to keep the existing balance."
          >
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={8}
              placeholder={"employee_number,vacation,sick\n446,120.5,340\n447,88,210"}
              className={inputClass + " font-mono text-sm"}
            />
          </Field>

          <Button onClick={onImport} disabled={pending}>
            {pending ? "Importing…" : "Import balances"}
          </Button>
        </div>
      ) : (
        <form action={onManual} className="flex flex-wrap items-end gap-4">
          <div className="w-40">
            <Field label="Employee number">
              <input name="employee_number" required className={inputClass} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Bank">
              <select name="bank" className={selectClass}>
                <option value="vacation">Vacation</option>
                <option value="sick">Sick</option>
              </select>
            </Field>
          </div>
          <div className="w-32">
            <Field label="Hours">
              <input
                name="hours"
                type="number"
                step="0.01"
                required
                className={inputClass}
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="As of">
              <input
                type="date"
                name="as_of"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
                className={inputClass}
              />
            </Field>
          </div>
          <div className="min-w-[12rem] flex-1">
            <Field label="Note (optional)">
              <input name="note" className={inputClass} />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}

      {result?.ok && (
        <p className="mt-4 text-sm text-emerald-700">{result.ok}</p>
      )}
      {result?.error && <p className="mt-4 text-sm text-red-700">{result.error}</p>}
      {result?.errors && result.errors.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"} had problems
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {result.errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
