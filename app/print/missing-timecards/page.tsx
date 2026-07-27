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

const STATUS_LABEL: Record<string, string> = {
  "no card": "No card",
  open: "Open",
  employee_approved: "Employee approved",
};

export default async function MissingPrintPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();
  const periodId = searchParams.period!;

  const [{ data: period }, { data: rows }] = await Promise.all([
    sb
      .from("pay_periods")
      .select("start_date, end_date, payroll_type")
      .eq("id", periodId)
      .single(),
    sb.rpc("missing_timecard_report", { p_pay_period_id: periodId }),
  ]);

  const list = (rows as any[]) ?? [];
  const noCard = list.filter((r) => r.card_status === "no card").length;
  const unapproved = list.length - noCard;

  return (
    <>
      <PrintControls count={1} label="Missing timecards ready" />
      <div className="tc-page to-report">
        <div className="tc-header">
          <div>Missing Timecards</div>
          <div>
            Pay Period:{" "}
            {period ? fmtRange(period.start_date, period.end_date) : ""}
            {period?.payroll_type === "bi_weekly" ? " (bi-weekly)" : ""}
          </div>
          <div>Date/Time Printed: {stamp()}</div>
        </div>

        <div className="mt-summary">
          {noCard} with no card · {unapproved} started but not approved
        </div>

        <table className="to-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th className="to-desc">Type</th>
              <th>Status</th>
              <th className="to-num">Entries</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i}>
                <td>{r.employee_number}</td>
                <td>
                  {r.last_name}, {r.first_name}
                </td>
                <td className="to-desc">
                  {r.employee_type?.replace(/_/g, " ")}
                </td>
                <td>{STATUS_LABEL[r.card_status] ?? r.card_status}</td>
                <td className="to-num">
                  {r.card_status === "no card" ? "—" : r.entry_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {list.length === 0 && (
          <p style={{ marginTop: "1em" }}>
            Every employee has a supervisor-approved card. Nothing outstanding.
          </p>
        )}
      </div>
    </>
  );
}
