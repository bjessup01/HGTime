"use client";

import { useRouter } from "next/navigation";
import { Panel, Button, Empty } from "@/components/ui";
import PeriodRangePicker from "@/components/reports/period-range-picker";

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
  const s = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  return `${s(f)} – ${s(t)}`;
}

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

export default function ShuttleReport({
  periods,
  rows,
  totals,
  from,
  to,
  periodId,
}: any) {
  const router = useRouter();

  function onRun(f: string, t: string, pid?: string) {
    const params = new URLSearchParams();
    params.set("from", f);
    params.set("to", t);
    if (pid) params.set("period", pid);
    router.push(`/admin/shuttle-report?${params.toString()}`);
  }

  const grand = totals.reduce(
    (s: number, t: any) => s + Number(t.total_amount),
    0
  );

  function openPrint() {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    window.open(`/print/shuttle?${params.toString()}`, "_blank", "noopener");
  }

  function exportCsv() {
    const lines = ["Last,First,Employee #,Date,Level,Amount"];
    for (const r of rows) {
      lines.push(
        [
          r.last_name,
          r.first_name,
          r.employee_number,
          r.work_date,
          `"${r.label}"`,
          Number(r.amount),
        ].join(",")
      );
    }
    lines.push("");
    lines.push("Totals by employee");
    for (const t of totals) {
      lines.push(
        `${t.last_name},${t.first_name},${t.employee_number},${t.day_count} days,,${Number(
          t.total_amount
        )}`
      );
    }
    lines.push(`,,,,Total,${grand}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shuttle-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Shuttle incentive report</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Incentives recorded by day, with dollar value.
        </p>
      </div>

      <Panel title="Filters">
        <PeriodRangePicker
          periods={periods}
          initialFrom={from}
          initialTo={to}
          initialPeriodId={periodId}
          onRun={onRun}
        />
      </Panel>

      <Panel
        title={`Incentives — ${fmtRange(from, to)}`}
        description={`${rows.length} day${rows.length === 1 ? "" : "s"}`}
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
          <Empty>No shuttle incentives recorded in this range.</Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Level</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => {
                const first =
                  i === 0 || rows[i - 1].employee_id !== r.employee_id;
                return (
                  <tr
                    key={i}
                    className="border-b border-[var(--line)] last:border-0"
                  >
                    <td className="py-2.5 pr-4">
                      {first ? (
                        <span className="font-medium">
                          {r.last_name}, {r.first_name}
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {fmtDate(r.work_date)}
                    </td>
                    <td className="py-2.5 pr-4">{r.label}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {money(r.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {totals.length > 0 && (
        <Panel title="Total by employee">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {totals.map((t: any) => (
                <tr
                  key={t.employee_id}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="py-2.5 pr-4">
                    {t.last_name}, {t.first_name}
                  </td>
                  <td className="py-2.5 pr-4 text-[var(--muted)]">
                    {t.day_count} day{t.day_count === 1 ? "" : "s"}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-medium">
                    {money(t.total_amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--ink)]">
                <td className="py-2.5 font-semibold" colSpan={2}>
                  Total
                </td>
                <td className="py-2.5 text-right tabular-nums font-semibold">
                  {money(grand)}
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
