"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  approveAsSupervisor,
  unapproveAsSupervisor,
  approveMany,
} from "@/lib/actions/approvals";
import { Panel, Button, Badge, Table, Empty, selectClass } from "@/components/ui";

function fmtRange(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}/${String(
    e.getFullYear()
  ).slice(2)}`;
}

export default function ApprovalQueue({
  queue,
  periods,
  currentPeriodId,
  payrollType,
  periodStart,
  periodEnd,
}: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  const awaiting = queue.filter((q: any) => q.status === "employee_approved");
  const approved = queue.filter((q: any) => q.status === "supervisor_approved");
  const open = queue.filter((q: any) => q.status === "open");

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function onApproveSelected() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const res = await approveMany(Array.from(selected));
      setSelected(new Set());
      setMessage(
        res.failed.length
          ? {
              error: `Approved ${res.approved}. ${res.failed.length} failed: ${res.failed[0]}`,
            }
          : { ok: `Approved ${res.approved} timecard${res.approved === 1 ? "" : "s"}.` }
      );
      router.refresh();
    });
  }

  function onApprove(id: string) {
    startTransition(async () => {
      const res = await approveAsSupervisor(id);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  function onUnapprove(id: string) {
    startTransition(async () => {
      const res = await unapproveAsSupervisor(id);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  function changePeriod(id: string) {
    router.push(`/approvals?payroll=${payrollType}&period=${id}`);
  }

  function changePayroll(type: string) {
    router.push(`/approvals?payroll=${type}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Approvals</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {fmtRange(periodStart, periodEnd)} · {queue.length} timecard
            {queue.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={payrollType}
            onChange={(e) => changePayroll(e.target.value)}
            className={selectClass + " w-auto py-2 text-sm"}
          >
            <option value="semi_monthly">Semi-monthly</option>
            <option value="bi_weekly">Bi-weekly</option>
          </select>

          <select
            value={currentPeriodId}
            onChange={(e) => changePeriod(e.target.value)}
            className={selectClass + " w-auto py-2 text-sm"}
          >
            {periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {fmtRange(p.start_date, p.end_date)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message?.ok && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message.ok}
        </p>
      )}
      {message?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {message.error}
        </p>
      )}

      <Panel
        title="Ready for your approval"
        description="Employees who have approved their own time."
        actions={
          selected.size > 0 ? (
            <Button onClick={onApproveSelected} disabled={pending}>
              {pending ? "Approving…" : `Approve ${selected.size} selected`}
            </Button>
          ) : undefined
        }
      >
        {awaiting.length === 0 ? (
          <Empty>Nothing waiting for approval.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size === awaiting.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set<string>(awaiting.map((q: any) => q.timecard_id))
                          : new Set<string>()
                      )
                    }
                    className="h-4 w-4"
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Worked</th>
                <th className="py-2 pr-4 font-medium">Time off</th>
                <th className="py-2 pr-4 font-medium">Total</th>
                <th className="py-2 pr-4 font-medium">OT</th>
                <th className="py-2 pr-4 font-medium">Flags</th>
                <th className="py-2 font-medium"></th>
              </>
            }
          >
            {awaiting.map((q: any) => (
              <tr key={q.timecard_id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(q.timecard_id)}
                    onChange={() => toggle(q.timecard_id)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="py-3 pr-4">
                  <Link
                    href={`/timecard?employee=${q.employee_id}`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {q.first_name} {q.last_name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                    #{q.employee_number}
                  </span>
                </td>
                <td className="py-3 pr-4 tabular-nums">{Number(q.worked_hours)}</td>
                <td className="py-3 pr-4 tabular-nums">{Number(q.time_off_hours)}</td>
                <td className="py-3 pr-4 font-medium tabular-nums">
                  {Number(q.total_hours)}
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {Number(q.ot_hours) > 0 ? (
                    <span className="text-amber-700">{Number(q.ot_hours)}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-3 pr-4">
                  {q.warning_count > 0 && (
                    <Badge tone="warn">{q.warning_count}</Badge>
                  )}
                </td>
                <td className="py-3">
                  <button
                    onClick={() => onApprove(q.timecard_id)}
                    disabled={pending}
                    className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
                  >
                    Approve
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {open.length > 0 && (
        <Panel
          title="Not yet approved by employee"
          description="You can approve these directly if needed — for someone out sick, or against a deadline."
        >
          <Table
            head={
              <>
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Total</th>
                <th className="py-2 pr-4 font-medium">Flags</th>
                <th className="py-2 font-medium"></th>
              </>
            }
          >
            {open.map((q: any) => (
              <tr key={q.timecard_id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-3 pr-4">
                  <Link
                    href={`/timecard?employee=${q.employee_id}`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {q.first_name} {q.last_name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                    #{q.employee_number}
                  </span>
                </td>
                <td className="py-3 pr-4 tabular-nums">{Number(q.total_hours)}</td>
                <td className="py-3 pr-4">
                  {q.warning_count > 0 && <Badge tone="warn">{q.warning_count}</Badge>}
                </td>
                <td className="py-3">
                  <button
                    onClick={() => onApprove(q.timecard_id)}
                    disabled={pending}
                    className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
                  >
                    Approve anyway
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {approved.length > 0 && (
        <Panel title="Approved" description="Overtime settled and floating holidays posted.">
          <Table
            head={
              <>
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Worked</th>
                <th className="py-2 pr-4 font-medium">Time off</th>
                <th className="py-2 pr-4 font-medium">Total</th>
                <th className="py-2 pr-4 font-medium">OT</th>
                <th className="py-2 font-medium"></th>
              </>
            }
          >
            {approved.map((q: any) => (
              <tr key={q.timecard_id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-3 pr-4">
                  <Link
                    href={`/timecard?employee=${q.employee_id}`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {q.first_name} {q.last_name}
                  </Link>
                </td>
                <td className="py-3 pr-4 tabular-nums">{Number(q.worked_hours)}</td>
                <td className="py-3 pr-4 tabular-nums">{Number(q.time_off_hours)}</td>
                <td className="py-3 pr-4 font-medium tabular-nums">
                  {Number(q.total_hours)}
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {Number(q.ot_hours) > 0 ? (
                    <span className="text-amber-700">{Number(q.ot_hours)}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-3">
                  <button
                    onClick={() => onUnapprove(q.timecard_id)}
                    disabled={pending}
                    className="text-sm text-red-600 hover:underline disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  );
}
