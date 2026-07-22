import { PrintCard } from "@/lib/print";

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
}

function fmtStamp(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}/${String(d.getFullYear()).slice(2)} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds()
  ).padStart(2, "0")}`;
}

function hrs(n: any) {
  return Number(n ?? 0).toFixed(2);
}

function fmtTime(t: string | null) {
  if (!t) return "00:00 AM";
  const [hStr, m] = t.split(":");
  let h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

export default function PrintableTimecard({
  card,
  printedAt,
}: {
  card: PrintCard;
  printedAt: string;
}) {
  const { header: h, notes, codesUsed, workLines, timeOffLines, weeks, totals } = card;

  // Group work lines by date so the date prints once per day
  const byDate = new Map<string, any[]>();
  for (const l of workLines) {
    const list = byDate.get(l.work_date) ?? [];
    list.push(l);
    byDate.set(l.work_date, list);
  }

  return (
    <div className="tc-page">
      <div className="tc-header">
        <div>
          Time Card for {h.employee_number} {h.employee_name}
        </div>
        <div>
          Date Range: {fmtDate(h.period_start)} {fmtDate(h.period_end)}
        </div>
        <div>
          Overtime period:{fmtDate(h.ot_start)} to {fmtDate(h.ot_end)}
        </div>
        <div>Date/Time Printed:{printedAt}</div>
      </div>

      {codesUsed.length > 0 && (
        <div className="tc-codes">
          <span className="tc-codes-label">Work codes used this period:</span>
          <span className="tc-codes-list">
            {codesUsed.map((c) => (
              <span key={c.code} className="tc-code-line">
                {c.code}
                {c.description}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* ---- detail lines ---- */}
      <table className="tc-detail">
        <thead>
          <tr>
            <th className="tc-col-date">Date</th>
            <th className="tc-col-wc">W/C</th>
            {!h.is_salaried && <th className="tc-col-punch">Punch In</th>}
            {!h.is_salaried && <th className="tc-col-punch">Punch Out</th>}
            <th className="tc-col-hours">Hours</th>
          </tr>
        </thead>
        <tbody>
          {h.is_salaried ? (
            <tr>
              <td>{fmtDate(h.period_start)}</td>
              <td>
                {h.default_work_code} {h.default_work_desc}
              </td>
              <td className="tc-num">{hrs(80)}</td>
            </tr>
          ) : (
            Array.from(byDate.entries()).map(([date, lines]) =>
              lines.map((l, i) => (
                <tr key={`${date}-${i}`}>
                  <td>{i === 0 ? fmtDate(date) : ""}</td>
                  <td>{l.description}</td>
                  <td>{fmtTime(l.start_time)}</td>
                  <td>{fmtTime(l.end_time)}</td>
                  <td className="tc-num">
                    {hrs(l.hours)}
                    {l.is_prior ? "*" : ""}
                  </td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>

      {/* ---- summary blocks ---- */}
      <div className="tc-summary">
        <div className="tc-summary-left">
          {!h.is_salaried && weeks.length > 0 && (
            <table className="tc-weeks">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th className="tc-num">Total</th>
                  <th className="tc-num">Regular</th>
                  <th className="tc-num">Overtime</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.week_start}>
                    <td>{fmtShort(w.week_start)}</td>
                    <td>{fmtShort(w.week_end)}</td>
                    <td className="tc-num">{hrs(w.total_hours)}</td>
                    <td className="tc-num">{hrs(w.regular)}</td>
                    <td className="tc-num">{hrs(w.overtime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!h.is_salaried && (
            <table className="tc-hours-totals">
              <tbody>
                <tr>
                  <td>Regular Hours</td>
                  <td className="tc-num">{hrs(totals.regular)}</td>
                </tr>
                <tr>
                  <td>Overtime Hours</td>
                  <td className="tc-num">{hrs(totals.overtime)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="tc-summary-right">
          <table className="tc-period-totals">
            <tbody>
              {h.is_salaried ? (
                <>
                  <tr>
                    <td>Default Regular Hours</td>
                    <td className="tc-num">{hrs(80)}</td>
                  </tr>
                  <tr>
                    <td>Time Off Hours</td>
                    <td className="tc-num">{hrs(totals.timeOff)}</td>
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <td>Hours Worked</td>
                    <td className="tc-num">{hrs(totals.hoursWorked)}</td>
                  </tr>
                  <tr>
                    <td>Time Off Hours</td>
                    <td className="tc-num">{hrs(totals.timeOff)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td />
                <td className="tc-rule">=========</td>
              </tr>
              <tr>
                <td>Total Hours</td>
                <td className="tc-num">{hrs(totals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- time off ---- */}
      {timeOffLines.length > 0 && (
        <div className="tc-timeoff">
          <div className="tc-timeoff-title">----Vacation/Sick----</div>
          <table className="tc-timeoff-table">
            <tbody>
              {timeOffLines.map((l, i) => (
                <tr key={i}>
                  <td>{fmtDate(l.work_date)}</td>
                  <td>{l.description}</td>
                  <td className="tc-num">{hrs(l.hours)}</td>
                </tr>
              ))}
              <tr>
                <td />
                <td />
                <td className="tc-rule">=========</td>
              </tr>
              <tr>
                <td />
                <td>VACATION Hours</td>
                <td className="tc-num">{hrs(totals.vacation)}</td>
              </tr>
              <tr>
                <td />
                <td>Sick Hours</td>
                <td className="tc-num">{hrs(totals.sick)}</td>
              </tr>
              <tr>
                <td />
                <td>Other Time Off</td>
                <td className="tc-num">{hrs(totals.other)}</td>
              </tr>
              <tr>
                <td />
                <td>Total Time Off</td>
                <td className="tc-num">{hrs(totals.timeOff)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!h.is_salaried && workLines.some((l) => l.is_prior) && (
        <div className="tc-footnote">
          *Time entries from previous pay period shown for overtime calculation.
          Hours are not included in total hours for this pay period.
        </div>
      )}

      {notes.length > 0 && (
        <div className="tc-notes">
          {notes.map((n, i) => (
            <div key={i} className="tc-note">
              <span className="tc-note-label">NOTE:</span>
              <span className="tc-note-body">
                {fmtDate(n.work_date)} {n.note_text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- approvals ---- */}
      <div className="tc-approvals">
        <div className="tc-approval-line">
          <span className="tc-approval-label">Employee:</span>
          <span className="tc-approval-name">
            {h.employee_approved_name ?? ""}
          </span>
          <span className="tc-approval-label">Date:</span>
          <span className="tc-approval-date">
            {fmtStamp(h.employee_approved_at)}
          </span>
        </div>
        <div className="tc-approval-line">
          <span className="tc-approval-label">Authorized By:</span>
          <span className="tc-approval-name">
            {h.supervisor_approved_name ?? ""}
          </span>
          <span className="tc-approval-label">Date:</span>
          <span className="tc-approval-date">
            {fmtStamp(h.supervisor_approved_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
