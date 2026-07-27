"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel, Badge, Empty, selectClass, Button } from "@/components/ui";

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

const STATUS: Record<string, { label: string; tone: any }> = {
  "no card": { label: "No card", tone: "warn" },
  open: { label: "Open", tone: "neutral" },
  employee_approved: { label: "Employee approved", tone: "neutral" },
};

export default function MissingTimecards({ periods, rows, periodId }: any) {
  const router = useRouter();

  function pick(id: string) {
    router.push(`/admin/missing-timecards?period=${id}`);
  }

  function openPrint() {
    window.open(
      `/print/missing-timecards?period=${periodId}`,
      "_blank",
      "noopener"
    );
  }

  const noCard = rows.filter((r: any) => r.card_status === "no card");
  const unapproved = rows.filter((r: any) => r.card_status !== "no card");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Missing timecards</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Employees without a supervisor-approved card for the period.
          </p>
        </div>

        <select
          value={periodId ?? ""}
          onChange={(e) => pick(e.target.value)}
          className={selectClass + " w-auto py-2 text-sm"}
        >
          {periods.map((p: any) => (
            <option key={p.id} value={p.id}>
              {fmt(p.start_date)} – {fmt(p.end_date)}
              {p.payroll_type === "bi_weekly" ? " (bi-weekly)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            No card started
          </p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              noCard.length > 0 ? "text-amber-700" : ""
            }`}
          >
            {noCard.length}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Started, not approved
          </p>
          <p className="mt-1 text-2xl font-semibold">{unapproved.length}</p>
        </div>
      </div>

      <Panel
        title="Employees"
        actions={
          rows.length > 0 ? (
            <Button variant="secondary" onClick={openPrint}>
              Print / PDF
            </Button>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <Empty>Every employee has a supervisor-approved card. Nothing outstanding.</Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium text-right">Entries</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const s = STATUS[r.card_status] ?? {
                  label: r.card_status,
                  tone: "neutral",
                };
                return (
                  <tr
                    key={r.employee_id}
                    className="border-b border-[var(--line)] last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      {r.employee_number}
                    </td>
                    <td className="py-2.5 pr-4">
                      {r.last_name}, {r.first_name}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--muted)]">
                      {r.employee_type?.replace(/_/g, " ")}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {r.card_status === "no card" ? (
                        <span className="text-[var(--muted)]">—</span>
                      ) : (
                        r.entry_count
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {r.card_status !== "no card" && (
                        <Link
                          href={`/timecard?employee=${r.employee_id}&period=${periodId}`}
                          className="text-sm text-[var(--accent)] hover:underline"
                        >
                          Open
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
