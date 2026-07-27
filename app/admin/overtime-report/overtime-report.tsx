"use client";

import { useRouter } from "next/navigation";
import { Panel, Button, Empty } from "@/components/ui";
import PeriodRangePicker from "@/components/reports/period-range-picker";

function fmtRange(from: string, to: string) {
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  const s = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  return `${s(f)} – ${s(t)}`;
}

function fmtWeek(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`;
}

export default function OvertimeReport({
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
    router.push(`/admin/overtime-report?${params.toString()}`);
  }

  const grand = totals.reduce((s: number, t: any) => s + Number(t.ot_hours), 0);

  function openPrint() {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    window.open(`/print/overtime?${params.toString()}`, "_blank", "noopener");
  }

  function exportCsv() {
    const lines = ["Last,First,Employee #,Week Start,Week End,Regular,Overtime"];
    for (const r of rows) {
      lines.push(
        [
          r.last_name,
          r.first_name,
          r.employee_number,
          r.week_start,
          r.week_end,
          Number(r.regular_hours),
          Number(r.ot_hours),
        ].join(",")
      );
    }
    lines.push("");
    lines.push("Totals by employee");
    for (const t of totals) {
      lines.push(
        `${t.last_name},${t.first_name},${t.employee_number},,,,${Number(t.ot_hours)}`
      );
    }
    lines.push(`,,,,,Total,${grand}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overtime-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overtime report</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Settled overtime from approved timecards, by workweek.
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
        title={`Overtime — ${fmtRange(from, to)}`}
        description={`${rows.length} week${rows.length === 1 ? "" : "s"} with overtime`}
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
          <Empty>
            No settled overtime in this range. Only supervisor-approved cards are
            included.
          </Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Week</th>
                <th className="py-2 pr-4 font-medium text-right">Regular</th>
                <th className="py-2 font-medium text-right">Overtime</th>
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
                      {fmtWeek(r.week_start, r.week_end)}
                      {r.is_split && (
                        <span
                          className="ml-1.5 text-xs text-[var(--muted)]"
                          title={`Split week — this line is the portion paid in the ${fmtWeek(
                            r.period_start,
                            r.period_end
                          )} pay period`}
                        >
                          †
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-[var(--muted)]">
                      {Number(r.regular_hours)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-medium">
                      {Number(r.ot_hours)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {rows.some((r: any) => r.is_split) && (
        <p className="-mt-2 text-xs text-[var(--muted)]">
          † This workweek was split across two pay periods. Each line shows the
          overtime settled in that period; the hours were paid where they were
          worked.
        </p>
      )}

      {totals.length > 0 && (
        <Panel title="Total overtime by employee">
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
                  <td className="py-2.5 text-right tabular-nums font-medium">
                    {Number(t.ot_hours)}h
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--ink)]">
                <td className="py-2.5 font-semibold">Total</td>
                <td className="py-2.5 text-right tabular-nums font-semibold">
                  {Math.round(grand * 100) / 100}h
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
