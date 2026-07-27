import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import PrintControls from "../print-controls";
import "../print.css";
import "../time-off/time-off-print.css";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${DAYS[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtRange(from: string, to: string) {
  const s = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
      d.getDate()
    ).padStart(2, "0")}/${d.getFullYear()}`;
  };
  return `${s(from)} to ${s(to)}`;
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

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export default async function ShuttlePrintPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();
  const from = searchParams.from!;
  const to = searchParams.to!;

  const [{ data: rows }, { data: totals }] = await Promise.all([
    sb.rpc("shuttle_report", { p_from: from, p_to: to }),
    sb.rpc("shuttle_report_totals", { p_from: from, p_to: to }),
  ]);

  const list = (rows as any[]) ?? [];
  const tots = (totals as any[]) ?? [];
  const grand = tots.reduce((s, t) => s + Number(t.total_amount), 0);

  return (
    <>
      <PrintControls count={1} label="Shuttle report ready" />
      <div className="tc-page to-report">
        <div className="tc-header">
          <div>Shuttle Incentive Report</div>
          <div>Date Range: {fmtRange(from, to)}</div>
          <div>Date/Time Printed: {stamp()}</div>
        </div>

        <table className="to-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th className="to-desc">Level</th>
              <th className="to-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const first = i === 0 || list[i - 1].employee_id !== r.employee_id;
              return (
                <tr key={i}>
                  <td>{first ? `${r.last_name}, ${r.first_name}` : ""}</td>
                  <td>{fmtDate(r.work_date)}</td>
                  <td className="to-desc">{r.label}</td>
                  <td className="to-num">{money(r.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="to-totals-title">Total by Employee</div>
        <table className="to-totals">
          <tbody>
            {tots.map((t) => (
              <tr key={t.employee_id}>
                <td>
                  {t.last_name}, {t.first_name}
                </td>
                <td>
                  {t.day_count} day{t.day_count === 1 ? "" : "s"}
                </td>
                <td className="to-num">{money(t.total_amount)}</td>
              </tr>
            ))}
            <tr className="to-grand">
              <td colSpan={2}>Total</td>
              <td className="to-num">{money(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
