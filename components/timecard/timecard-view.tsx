"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAsEmployee,
  unapproveAsEmployee,
} from "@/lib/actions/timecard";
import { summarize } from "@/lib/timecard-calc";
import { Panel, Button, Badge, selectClass } from "@/components/ui";
import DayRow from "./day-row";
import HolidayElections from "./holiday-elections";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtRange(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}/${String(
    e.getFullYear()
  ).slice(2)}`;
}

export default function TimecardView({
  data,
  codes,
  periods,
  currentPeriodId,
  isSalaried,
  isOwnCard,
  canEdit,
  networkBlocked,
  viewingName,
  shuttleEligible,
  scheduleCode,
}: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const { card, scaffold, entries, days, warnings, holidaySummary,
          conversions, otPreview, floatingHolidayBalance } = data;
  const period = card.pay_periods;
  const totals = summarize(entries);

  const entriesByDate = new Map<string, any[]>();
  for (const e of entries) {
    const list = entriesByDate.get(e.work_date) ?? [];
    list.push(e);
    entriesByDate.set(e.work_date, list);
  }

  const dayMetaByDate = new Map<string, any>();
  for (const d of days) dayMetaByDate.set(d.work_date, d);

  const warningsByDate = new Map<string, any[]>();
  for (const w of warnings) {
    const list = warningsByDate.get(w.work_date) ?? [];
    list.push(w);
    warningsByDate.set(w.work_date, list);
  }

  const isApproved = card.status !== "open";
  const isExported = card.status === "exported";
  const editable = canEdit && !isExported;

  function onApprove() {
    startTransition(async () => {
      const res = await approveAsEmployee(card.id);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  function onUnapprove() {
    startTransition(async () => {
      const res = await unapproveAsEmployee(card.id);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  const missingDays = warnings.filter((w: any) => w.kind === "missing_day");
  const needsElection = holidaySummary.filter(
    (h: any) => h.needs_election && !h.election
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {viewingName ? `${viewingName}'s time` : "My time"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {fmtRange(period.start_date, period.end_date)} ·{" "}
            {period.payroll_type === "semi_monthly" ? "Semi-monthly" : "Bi-weekly"}
            {scheduleCode && ` · ${scheduleCode}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={currentPeriodId}
            onChange={(e) => {
              const params = new URLSearchParams(window.location.search);
              params.set("period", e.target.value);
              router.push(`/timecard?${params.toString()}`);
            }}
            className={selectClass + " w-auto py-2 text-sm"}
          >
            {periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {fmtRange(p.start_date, p.end_date)}
              </option>
            ))}
          </select>

          <StatusBadge status={card.status} />
        </div>
      </div>

      {networkBlocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            You are not on a company network
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Your time can be viewed but not changed from here. Use a company
            computer or connect to the location WiFi. Contact payroll if you need
            remote access.
          </p>
        </div>
      )}

      {(missingDays.length > 0 || needsElection.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {missingDays.length > 0 &&
              `${missingDays.length} scheduled ${
                missingDays.length === 1 ? "day has" : "days have"
              } no time entered`}
            {missingDays.length > 0 && needsElection.length > 0 && " · "}
            {needsElection.length > 0 &&
              `${needsElection.length} holiday ${
                needsElection.length === 1 ? "choice" : "choices"
              } pending`}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            These are reminders, not blockers — you can still approve. Check each
            flagged day below.
          </p>
        </div>
      )}

      {holidaySummary.some((h: any) => h.worked_hours > 0) && (
        <HolidayElections
          timecardId={card.id}
          summary={holidaySummary}
          conversions={conversions}
          isSalaried={isSalaried}
          editable={editable}
        />
      )}

      <Panel title="Days">
        <div className="space-y-2">
          {scaffold.map((day: any) => (
            <DayRow
              key={day.work_date}
              timecardId={card.id}
              day={day}
              entries={entriesByDate.get(day.work_date) ?? []}
              meta={dayMetaByDate.get(day.work_date)}
              warnings={warningsByDate.get(day.work_date) ?? []}
              codes={codes}
              editable={editable}
              isSalaried={isSalaried}
              shuttleEligible={shuttleEligible}
              label={fmtDate(day.work_date)}
            />
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Period totals">
          <dl className="space-y-2 text-sm">
            <Row label="Worked" value={totals.worked} />
            <Row label="Holiday" value={totals.holiday} />
            <Row
              label="Other time off"
              value={Math.round((totals.timeOff - totals.holiday) * 100) / 100}
            />
            <div className="border-t border-[var(--line)] pt-2">
              <Row label="Total" value={totals.total} bold />
            </div>
            {floatingHolidayBalance > 0 && (
              <div className="border-t border-[var(--line)] pt-2 text-[var(--muted)]">
                <Row label="Floating holiday balance" value={floatingHolidayBalance} />
              </div>
            )}
          </dl>
        </Panel>

        <Panel
          title="By workweek"
          description="Sunday–Saturday. Holiday hours count toward overtime; other time-off codes do not."
        >
          {otPreview.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No hours entered yet.</p>
          ) : (
            <div className="space-y-4">
              {otPreview.map((w: any) => (
                <div key={w.week_start} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      Week of {fmtDate(w.week_start).replace(/^\w+ /, "")}
                      {w.is_split_week && (
                        <span className="ml-2">
                          <Badge tone="neutral">
                            {w.settles_here ? "week ends here" : "continues next period"}
                          </Badge>
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      {Number(w.this_regular)}
                      {Number(w.this_ot) > 0 && (
                        <span className="ml-2 text-amber-700">
                          +{Number(w.this_ot)} OT
                        </span>
                      )}
                    </span>
                  </div>

                  {(Number(w.prior_regular) > 0 || Number(w.prior_ot) > 0) && (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {Number(w.prior_regular) + Number(w.prior_ot)}h already paid last
                      period. Full week: {Number(w.week_total)}h.
                    </p>
                  )}

                  {w.is_split_week && !w.settles_here && (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      This week continues into the next period. Any overtime is
                      calculated and paid there, once the full week is known.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {isOwnCard && !isExported && (
        <Panel title="Approval">
          {card.status === "open" ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--muted)]">
                Approving confirms your time is complete and correct. You can still
                make changes afterward — your supervisor approves last.
              </p>
              <Button onClick={onApprove} disabled={pending || !editable}>
                {pending ? "Approving…" : "Approve my time"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-emerald-700">
                You approved this timecard
                {card.employee_approved_at &&
                  ` on ${new Date(card.employee_approved_at).toLocaleDateString()}`}
                .
                {card.status === "employee_approved" &&
                  " Waiting for supervisor approval."}
              </p>
              {card.status === "employee_approved" && (
                <Button variant="secondary" onClick={onUnapprove} disabled={pending}>
                  Withdraw approval
                </Button>
              )}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: any }> = {
    open: { label: "Open", tone: "neutral" },
    employee_approved: { label: "Employee approved", tone: "warn" },
    supervisor_approved: { label: "Supervisor approved", tone: "good" },
    exported: { label: "Exported", tone: "good" },
  };
  const s = map[status] ?? map.open;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
