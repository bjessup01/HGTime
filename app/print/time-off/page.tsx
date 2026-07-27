import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import PrintControls from "../print-controls";
import "../print.css";
import "./time-off-print.css";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${DAYS[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtRange(from: string, to: string) {
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  const s = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(
      2,
      "0"
    )}/${d.getFullYear()}`;
  return `${s(f)} to ${s(t)}`;
}

function stamp() {
  const d = new Date();
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return (
    `${String(d.getMonth() + 1).padStart(2, "0")}/` +
    `${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()} ` +
    `${String(h12).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`
  );
}

export default async function TimeOffPrintPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; codes?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const from = searchParams.from!;
  const to = searchParams.to!;
  const codes = searchParams.codes
    ? searchParams.codes.split(",").filter(Boolean)
    : null;

  const [{ data: rows }, { data: totals }] = await Promise.all([
    sb.rpc("time_off_report", { p_from: from, p_to: to, p_codes: codes }),
    sb.rpc("time_off_report_totals", { p_from: from, p_to: to, p_codes: codes }),
  ]);

  const list = (rows as any[]) ?? [];
  const tots = (totals as any[]) ?? [];
  const grand = tots.reduce((s, t) => s + Number(t.total_hours), 0);

  return (
    <>
      <PrintControls count={1} label="Time-off report ready" />
      <div className="tc-page to-report">
        <div className="tc-header">
          <div>Time-Off Report</div>
          <div>Date Range: {fmtRange(from, to)}</div>
          <div>Date/Time Printed: {stamp()}</div>
        </div>

        <table className="to-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Code</th>
              <th className="to-desc">Description</th>
              <th className="to-num">Hours</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const first =
                i === 0 || list[i - 1].employee_id !== r.employee_id;
              return (
                <tr key={i}>
                  <td>
                    {first ? `${r.last_name}, ${r.first_name}` : ""}
                  </td>
                  <td>{fmtDate(r.work_date)}</td>
                  <td>{r.code}</td>
                  <td className="to-desc">
                    {r.description}
                    {r.unpaid ? " (unpaid)" : ""}
                  </td>
                  <td className="to-num">{Number(r.hours).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="to-totals-title">Totals by Code</div>
        <table className="to-totals">
          <tbody>
            {tots.map((t) => (
              <tr key={t.code}>
                <td>{t.code}</td>
                <td className="to-desc">{t.description}</td>
                <td className="to-num">{Number(t.total_hours).toFixed(2)}</td>
              </tr>
            ))}
            <tr className="to-grand">
              <td colSpan={2}>Total</td>
              <td className="to-num">{grand.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
