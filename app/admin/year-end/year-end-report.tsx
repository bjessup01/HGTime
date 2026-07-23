"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveYearEndRun } from "@/lib/actions/year-end";
import { Panel, Button, Badge, Table, Empty, inputClass } from "@/components/ui";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function n(v: any) {
  return Number(v ?? 0);
}

export default function YearEndReport({ rows, runs, config, view }: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsAction = rows.filter((r: any) => r.action_required);
  const atRisk = rows.filter((r: any) => n(r.vacation_over) > 0);
  const totalForfeited = rows.reduce(
    (s: number, r: any) => s + n(r.vacation_forfeited),
    0
  );
  const hasPending = rows.some(
    (r: any) => n(r.pending_vacation) > 0 || n(r.pending_sick) > 0
  );

  // fiscal year is derived from the first row's projection
  const fiscalYear = new Date().getFullYear();

  function setView(v: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("view", v);
    router.push(`/admin/year-end?${params.toString()}`);
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveYearEndRun(fiscalYear, notes);
      if (res.ok) {
        setSaved("Run saved. The figures are recorded for audit.");
        setError(null);
        setNotes("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function exportCsv() {
    const header = [
      "employee_number",
      "last_name",
      "first_name",
      "snapshot_vacation",
      "snapshot_sick",
      "pending_vacation",
      "pending_sick",
      "projected_vacation",
      "projected_sick",
      "vacation_to_sick",
      "vacation_forfeited",
      "sick_to_vacation",
      "final_vacation",
      "final_sick",
      "ENTER_vacation",
      "ENTER_sick",
    ];

    const lines = [header.join(",")];
    for (const r of needsAction) {
      lines.push(
        [
          r.employee_number,
          r.last_name,
          r.first_name,
          n(r.snapshot_vacation),
          n(r.snapshot_sick),
          n(r.pending_vacation),
          n(r.pending_sick),
          n(r.projected_vacation),
          n(r.projected_sick),
          n(r.vacation_to_sick),
          n(r.vacation_forfeited),
          n(r.sick_to_vacation),
          n(r.final_vacation),
          n(r.final_sick),
          r.needs_vacation_entry ? n(r.enter_vacation) : "",
          r.needs_sick_entry ? n(r.enter_sick) : "",
        ].join(",")
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `year-end-${fiscalYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Year-end conversion</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Carryover limits: {n(config?.vacation_carryover_max)}h vacation,{" "}
            {n(config?.sick_carryover_max)}h sick
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setView("monitor")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              view === "monitor"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)] bg-white"
            }`}
          >
            Monitor
          </button>
          <button
            onClick={() => setView("entry")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              view === "entry"
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--line)] bg-white"
            }`}
          >
            Payroll entry
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Employees" value={rows.length} />
        <Stat
          label="At risk of losing vacation"
          value={atRisk.length}
          tone={atRisk.length > 0 ? "warn" : undefined}
        />
        <Stat
          label="Hours forfeited"
          value={Math.round(totalForfeited * 100) / 100}
          tone={totalForfeited > 0 ? "bad" : undefined}
        />
        <Stat label="Need an adjustment" value={needsAction.length} />
      </div>

      {rows.some((r: any) => !r.has_accrual_rate) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {rows.filter((r: any) => !r.has_accrual_rate).length} employee
            {rows.filter((r: any) => !r.has_accrual_rate).length === 1 ? "" : "s"}{" "}
            have no accrual rate on file
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Their projections show only the imported balance less time off — no
            future accrual. Add rates on the employee page for a complete picture.
          </p>
        </div>
      )}

      {view === "monitor" ? (
        <MonitorView rows={rows} atRisk={atRisk} />
      ) : (
        <EntryView
          rows={needsAction}
          hasPending={hasPending}
          onExport={exportCsv}
          notes={notes}
          setNotes={setNotes}
          onSave={onSave}
          pending={pending}
          saved={saved}
          error={error}
        />
      )}

      {runs.length > 0 && (
        <Panel title="Previous runs">
          <Table
            head={
              <>
                <th className="py-2 pr-4 font-medium">Fiscal year</th>
                <th className="py-2 pr-4 font-medium">Run</th>
                <th className="py-2 pr-4 font-medium">By</th>
                <th className="py-2 font-medium">Notes</th>
              </>
            }
          >
            {runs.map((r: any) => (
              <tr key={r.id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-3 pr-4">{r.fiscal_year}</td>
                <td className="py-3 pr-4">
                  {new Date(r.run_at).toLocaleDateString()}
                </td>
                <td className="py-3 pr-4">
                  {r.employees
                    ? `${r.employees.first_name} ${r.employees.last_name}`
                    : "—"}
                </td>
                <td className="py-3 text-[var(--muted)]">{r.notes ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  );
}

/** Monthly tracking view — who's trending toward losing time. */
function MonitorView({ rows, atRisk }: any) {
  return (
    <>
      <Panel
        title="At risk of losing vacation"
        description="Projected to be over the carryover limit at fiscal year end. These employees should use time before then."
      >
        {atRisk.length === 0 ? (
          <Empty>Nobody is over the vacation limit.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">On file</th>
                <th className="py-2 pr-4 font-medium">Accrues</th>
                <th className="py-2 pr-4 font-medium">Projected vacation</th>
                <th className="py-2 pr-4 font-medium">Over by</th>
                <th className="py-2 pr-4 font-medium">Converts to sick</th>
                <th className="py-2 font-medium">Would be lost</th>
              </>
            }
          >
            {atRisk.map((r: any) => (
              <tr key={r.employee_id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-3 pr-4 font-mono text-xs">{r.employee_number}</td>
                <td className="py-3 pr-4">
                  {r.first_name} {r.last_name}
                </td>
                <td className="py-3 pr-4 tabular-nums text-[var(--muted)]">
                  {n(r.snapshot_vacation)}
                </td>
                <td className="py-3 pr-4 tabular-nums text-[var(--muted)]">
                  {n(r.accrual_vacation) > 0 ? `+${n(r.accrual_vacation)}` : "—"}
                </td>
                <td className="py-3 pr-4 tabular-nums">{n(r.projected_vacation)}</td>
                <td className="py-3 pr-4 tabular-nums font-medium text-amber-700">
                  {n(r.vacation_over)}
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {n(r.vacation_to_sick) > 0 ? n(r.vacation_to_sick) : "—"}
                </td>
                <td className="py-3 tabular-nums">
                  {n(r.vacation_forfeited) > 0 ? (
                    <span className="font-medium text-red-700">
                      {n(r.vacation_forfeited)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="All employees" description="Current projection for everyone with a balance.">
        <Table
          head={
            <>
              <th className="py-2 pr-4 font-medium">#</th>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Vacation</th>
              <th className="py-2 pr-4 font-medium">Sick</th>
              <th className="py-2 font-medium">Status</th>
            </>
          }
        >
          {rows.map((r: any) => (
            <tr key={r.employee_id} className="border-b border-[var(--line)] last:border-0">
              <td className="py-3 pr-4 font-mono text-xs">{r.employee_number}</td>
              <td className="py-3 pr-4">
                {r.first_name} {r.last_name}
              </td>
              <td className="py-3 pr-4 tabular-nums">{n(r.projected_vacation)}</td>
              <td className="py-3 pr-4 tabular-nums">{n(r.projected_sick)}</td>
              <td className="py-3">
                {r.action_required ? (
                  <Badge tone="warn">Converts</Badge>
                ) : (
                  <Badge tone="good">No change</Badge>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

/** The April view — exactly what to key into the payroll system. */
function EntryView({
  rows,
  hasPending,
  onExport,
  notes,
  setNotes,
  onSave,
  pending,
  saved,
  error,
}: any) {
  return (
    <>
      {hasPending && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">
            Entry values include unprocessed time off
          </p>
          <p className="mt-1 text-sm text-blue-800">
            Some employees have time off entered here that payroll has not
            processed yet. The <strong>Enter</strong> columns add those hours back,
            so when the period runs and subtracts them the employee lands on the
            correct balance. Enter the value in the <strong>Enter</strong> column,
            not the final balance.
          </p>
        </div>
      )}

      <Panel
        title="Adjustments to enter"
        description="One row per employee needing a change. Employees with no conversion are omitted."
        actions={
          <Button variant="secondary" onClick={onExport}>
            Export CSV
          </Button>
        }
      >
        {rows.length === 0 ? (
          <Empty>No adjustments needed — nobody is over a carryover limit.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">On file</th>
                  <th className="py-2 pr-3 font-medium">Pending</th>
                  <th className="py-2 pr-3 font-medium">True 3/31</th>
                  <th className="py-2 pr-3 font-medium">Converts</th>
                  <th className="py-2 pr-3 font-medium">Lost</th>
                  <th className="py-2 pr-3 font-medium">Employee ends</th>
                  <th className="border-l border-[var(--line)] py-2 pl-3 pr-3 font-semibold text-[var(--ink)]">
                    Enter vac
                  </th>
                  <th className="py-2 font-semibold text-[var(--ink)]">Enter sick</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.employee_id} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-3 pr-3 font-mono text-xs">{r.employee_number}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">
                      {r.last_name}, {r.first_name}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-[var(--muted)]">
                      {n(r.snapshot_vacation)} / {n(r.snapshot_sick)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-[var(--muted)]">
                      {n(r.pending_vacation) || n(r.pending_sick)
                        ? `${n(r.pending_vacation)} / ${n(r.pending_sick)}`
                        : "—"}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {n(r.projected_vacation)} / {n(r.projected_sick)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {n(r.vacation_to_sick) > 0 && (
                        <span className="block whitespace-nowrap">
                          {n(r.vacation_to_sick)}h vac→sick
                        </span>
                      )}
                      {n(r.sick_to_vacation) > 0 && (
                        <span className="block whitespace-nowrap">
                          {n(r.sick_to_vacation)}h sick→vac
                        </span>
                      )}
                      {!n(r.vacation_to_sick) && !n(r.sick_to_vacation) && "—"}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">
                      {n(r.vacation_forfeited) > 0 ? (
                        <span className="text-red-700">{n(r.vacation_forfeited)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-[var(--muted)]">
                      {n(r.final_vacation)} / {n(r.final_sick)}
                    </td>
                    <td className="border-l border-[var(--line)] py-3 pl-3 pr-3 tabular-nums font-semibold">
                      {r.needs_vacation_entry ? n(r.enter_vacation) : "—"}
                    </td>
                    <td className="py-3 tabular-nums font-semibold">
                      {r.needs_sick_entry ? n(r.enter_sick) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Record this run"
        description="Saves the figures as they stand now, so what was entered stays auditable."
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. entered in payroll 4/1"
              className={inputClass}
            />
          </div>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save run"}
          </Button>
        </div>

        {saved && <p className="mt-3 text-sm text-emerald-700">{saved}</p>}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </Panel>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "bad"
            ? "text-red-700"
            : tone === "warn"
            ? "text-amber-700"
            : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
