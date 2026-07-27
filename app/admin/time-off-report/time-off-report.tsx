"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, Button, Empty, inputClass } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}/${String(
    d.getFullYear()
  ).slice(2)}`;
}

function fmtRange(from: string, to: string) {
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  return `${f.getMonth() + 1}/${f.getDate()}/${String(f.getFullYear()).slice(
    2
  )} – ${t.getMonth() + 1}/${t.getDate()}/${String(t.getFullYear()).slice(2)}`;
}

export default function TimeOffReport({
  codes,
  rows,
  totals,
  from,
  to,
  selectedCodes,
}: any) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [picked, setPicked] = useState<Set<string>>(
    new Set(selectedCodes ?? [])
  );

  const allSelected = picked.size === 0; // empty = all

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  function run() {
    const params = new URLSearchParams();
    params.set("from", fromDate);
    params.set("to", toDate);
    if (picked.size > 0) params.set("codes", Array.from(picked).join(","));
    router.push(`/admin/time-off-report?${params.toString()}`);
  }

  const grandTotal = totals.reduce(
    (s: number, t: any) => s + Number(t.total_hours),
    0
  );

  function openPrint() {
    // print the currently displayed report, not the unsaved filter state
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    if (selectedCodes && selectedCodes.length > 0) {
      params.set("codes", selectedCodes.join(","));
    }
    window.open(`/print/time-off?${params.toString()}`, "_blank", "noopener");
  }

  function exportCsv() {
    const lines = ["Last,First,Employee #,Date,Code,Description,Hours,Unpaid"];
    for (const r of rows) {
      lines.push(
        [
          r.last_name,
          r.first_name,
          r.employee_number,
          r.work_date,
          r.code,
          `"${r.description}"`,
          Number(r.hours),
          r.unpaid ? "unpaid" : "",
        ].join(",")
      );
    }
    lines.push("");
    lines.push("Totals by code");
    for (const t of totals) {
      lines.push(`,,,,${t.code},"${t.description}",${Number(t.total_hours)}`);
    }
    lines.push(`,,,,,Total,${grandTotal}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `time-off-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // group rows by employee for readable sub-headers, preserving sort
  const groups: { key: string; name: string; number: string; rows: any[] }[] = [];
  for (const r of rows) {
    const key = r.employee_id;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        name: `${r.last_name}, ${r.first_name}`,
        number: r.employee_number,
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(r);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Time-off report</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Time off taken by date range and code.
        </p>
      </div>

      <Panel title="Filters">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium">Through</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <Button onClick={run}>Run report</Button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium">
                Codes{" "}
                <span className="text-[var(--muted)]">
                  {allSelected ? "(all)" : `(${picked.size} selected)`}
                </span>
              </label>
              {picked.size > 0 && (
                <button
                  onClick={() => setPicked(new Set())}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  Select all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {codes.map((c: any) => {
                const on = allSelected || picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    title={c.description}
                    className={`rounded-md border px-2.5 py-1 text-sm transition ${
                      on && !allSelected
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : on
                        ? "border-[var(--line)] bg-[var(--bg)]"
                        : "border-[var(--line)] bg-white text-[var(--muted)]"
                    }`}
                  >
                    {c.code}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Leave all unselected to include every code. Tap to narrow.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title={`Results — ${fmtRange(from, to)}`}
        description={`${rows.length} line${rows.length === 1 ? "" : "s"}`}
        actions={
          rows.length > 0 ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={openPrint}>
                Print / PDF
              </Button>
              <Button variant="secondary" onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <Empty>No time off in this range for the selected codes.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 font-medium text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) =>
                  g.rows.map((r: any, i: number) => (
                    <tr
                      key={`${g.key}-${i}`}
                      className="border-b border-[var(--line)] last:border-0"
                    >
                      <td className="py-2.5 pr-4">
                        {i === 0 ? (
                          <span className="font-medium">{g.name}</span>
                        ) : (
                          <span className="text-[var(--muted)]">&nbsp;</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        {fmtDate(r.work_date)}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{r.code}</td>
                      <td className="py-2.5 pr-4 text-[var(--muted)]">
                        {r.description}
                        {r.unpaid && (
                          <span className="ml-2 text-xs">(unpaid)</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {Number(r.hours)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {totals.length > 0 && (
        <Panel title="Totals by code">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {totals.map((t: any) => (
                <tr
                  key={t.code}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="py-2.5 pr-4 font-mono text-xs">{t.code}</td>
                  <td className="py-2.5 pr-4 text-[var(--muted)]">
                    {t.description}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-medium">
                    {Number(t.total_hours)}h
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--ink)]">
                <td className="py-2.5 pr-4 font-semibold" colSpan={2}>
                  Total
                </td>
                <td className="py-2.5 text-right tabular-nums font-semibold">
                  {Math.round(grandTotal * 100) / 100}h
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
