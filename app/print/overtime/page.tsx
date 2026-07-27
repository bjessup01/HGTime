import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import PrintControls from "../print-controls";
import "../print.css";
import "../time-off/time-off-print.css";

function fmtRange(from: string, to: string) {
  const s = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
      d.getDate()
    ).padStart(2, "0")}/${d.getFullYear()}`;
  };
  return `${s(from)} to ${s(to)}`;
}

function fmtWeek(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const f = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return `${f(s)} – ${f(e)}`;
}

function stamp() {
  const d = new Date();
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return (
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/` +
    `${d.getFullYear()} ${String(h12).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`
  );
}

export default async function OvertimePrintPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();
  const from = searchParams.from!;
  const to = searchParams.to!;

  const [{ data: rows }, { data: totals }] = await Promise.all([
    sb.rpc("overtime_report", { p_from: from, p_to: to }),
    sb.rpc("overtime_report_totals", { p_from: from, p_to: to }),
  ]);

  const list = (rows as any[]) ?? [];
  const tots = (totals as any[]) ?? [];
  const grand = tots.reduce((s, t) => s + Number(t.ot_hours), 0);
  const anySplit = list.some((r) => r.is_split);

  return (
    <>
      <PrintControls count={1} label="Overtime report ready" />
      <div className="tc-page to-report">
        <div className="tc-header">
          <div>Overtime Report</div>
          <div>Date Range: {fmtRange(from, to)}</div>
          <div>Date/Time Printed: {stamp()}</div>
        </div>

        <table className="to-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Week</th>
              <th className="to-num">Regular</th>
              <th className="to-num">Overtime</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const first = i === 0 || list[i - 1].employee_id !== r.employee_id;
              return (
                <tr key={i}>
                  <td>{first ? `${r.last_name}, ${r.first_name}` : ""}</td>
                  <td>
                    {fmtWeek(r.week_start, r.week_end)}
                    {r.is_split ? " †" : ""}
                  </td>
                  <td className="to-num">{Number(r.regular_hours).toFixed(2)}</td>
                  <td className="to-num">{Number(r.ot_hours).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="to-totals-title">Total Overtime by Employee</div>
        <table className="to-totals">
          <tbody>
            {tots.map((t) => (
              <tr key={t.employee_id}>
                <td>
                  {t.last_name}, {t.first_name}
                </td>
                <td className="to-num">{Number(t.ot_hours).toFixed(2)}</td>
              </tr>
            ))}
            <tr className="to-grand">
              <td>Total</td>
              <td className="to-num">{grand.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        {anySplit && (
          <div className="to-footnote">
            † This work week was split across two pay periods. Each line shows the
            overtime settled in that period.
          </div>
        )}
      </div>
    </>
  );
}
