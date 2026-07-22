"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { purgeAuditLog } from "@/lib/actions/audit";
import { Panel, Button, Badge, Empty, selectClass, inputClass } from "@/components/ui";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function AuditView({ rows, error, employees, purge, filters }: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [showPurge, setShowPurge] = useState(false);

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/admin/audit?${params.toString()}`);
  }

  function onPurge() {
    if (
      !confirm(
        `Delete ${purge?.eligible_rows ?? 0} audit records from before ` +
          `${purge?.cutoff_date}? This removes change history only — ` +
          `timecards and hours are not affected. This cannot be undone.`
      )
    )
      return;

    startTransition(async () => {
      const res = await purgeAuditLog();
      setPurgeResult(
        res.ok
          ? `Deleted ${res.deleted} audit records.`
          : `Failed: ${res.error}`
      );
      router.refresh();
    });
  }

  const edits = rows.filter((r: any) => r.edited_by_other);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Every change to a timecard, who made it, and when.
        </p>
      </div>

      <Panel title="Filter">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium">From</label>
            <input
              type="date"
              defaultValue={filters.from}
              onChange={(e) => apply({ from: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">To</label>
            <input
              type="date"
              defaultValue={filters.to}
              onChange={(e) => apply({ to: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Employee</label>
            <select
              defaultValue={filters.employee}
              onChange={(e) => apply({ employee: e.target.value })}
              className={selectClass}
            >
              <option value="">Anyone</option>
              {employees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.last_name}, {e.first_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Changed by</label>
            <select
              defaultValue={filters.actor}
              onChange={(e) => apply({ actor: e.target.value })}
              className={selectClass}
            >
              <option value="">Anyone</option>
              {employees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.last_name}, {e.first_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2.5 text-sm">
              <input
                type="checkbox"
                defaultChecked={filters.system}
                onChange={(e) => apply({ system: e.target.checked ? "1" : "" })}
                className="h-4 w-4"
              />
              Show automatic changes
            </label>
          </div>
        </div>
      </Panel>

      {edits.length > 0 && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-5 py-3">
          <p className="text-sm">
            <span className="font-medium">{edits.length}</span> of these changes were
            made by someone other than the employee whose card it is.
          </p>
        </div>
      )}

      <Panel
        title="Changes"
        description={
          rows.length >= 300
            ? "Showing the 300 most recent. Narrow the filters to see more."
            : `${rows.length} change${rows.length === 1 ? "" : "s"}`
        }
      >
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : rows.length === 0 ? (
          <Empty>No changes match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Who</th>
                  <th className="py-2 pr-4 font-medium">Whose card</th>
                  <th className="py-2 pr-4 font-medium">Day</th>
                  <th className="py-2 pr-4 font-medium">What</th>
                  <th className="py-2 pr-4 font-medium">Was</th>
                  <th className="py-2 font-medium">Now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2.5 pr-4 whitespace-nowrap text-[var(--muted)]">
                      {fmtWhen(r.logged_at)}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {r.actor_name}
                      {r.edited_by_other && (
                        <span className="ml-2">
                          <Badge tone="warn">edit</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap text-[var(--muted)]">
                      {r.subject_name}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {fmtDay(r.work_date)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs">{r.description}</span>
                      {r.is_system && (
                        <span className="ml-2">
                          <Badge>auto</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--muted)]">
                      {r.action === "insert" ? "—" : r.was ?? "—"}
                    </td>
                    <td className="py-2.5">
                      {r.action === "delete" ? (
                        <span className="text-red-700">removed</span>
                      ) : (
                        r.now_is ?? "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Retention"
        actions={
          <Button variant="secondary" onClick={() => setShowPurge(!showPurge)}>
            {showPurge ? "Hide" : "Manage"}
          </Button>
        }
      >
        <p className="text-sm text-[var(--muted)]">
          {purge ? (
            <>
              {Number(purge.total_rows).toLocaleString()} records on file
              {purge.oldest_row &&
                `, oldest from ${new Date(purge.oldest_row).toLocaleDateString()}`}
              .
            </>
          ) : (
            "No records yet."
          )}
        </p>

        {showPurge && purge && (
          <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
            <p className="text-sm">
              Purging removes audit records from before{" "}
              <strong>{purge.cutoff_date}</strong> — the current year and the prior
              full year are kept.
            </p>
            <p className="text-sm text-[var(--muted)]">
              This removes change history only. Timecards, hours, overtime,
              balances, and year-end results are never affected.
            </p>
            <p className="text-sm">
              <strong>{Number(purge.eligible_rows).toLocaleString()}</strong> records
              are eligible.
            </p>
            <Button
              variant="danger"
              onClick={onPurge}
              disabled={pending || Number(purge.eligible_rows) === 0}
            >
              {pending ? "Purging…" : "Purge old records"}
            </Button>
          </div>
        )}

        {purgeResult && (
          <p className="mt-3 text-sm text-emerald-700">{purgeResult}</p>
        )}
      </Panel>
    </div>
  );
}
