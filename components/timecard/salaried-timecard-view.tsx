"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAsEmployee,
  unapproveAsEmployee,
  confirmRemainingDays,
} from "@/lib/actions/timecard";
import { Panel, Button, Badge, selectClass } from "@/components/ui";
import SalariedDayRow from "./salaried-day-row";
import HolidayElections from "./holiday-elections";
import TimecardHistory from "./timecard-history";
import RangeTimeOff from "./range-time-off";

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

export default function SalariedTimecardView({
  data,
  codes,
  periods,
  currentPeriodId,
  isOwnCard,
  canEdit,
  networkBlocked,
  viewingName,
  scheduleCode,
}: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    card,
    entries,
    days,
    holidaySummary,
    conversions,
    salariedDays,
    salariedSummary,
    salariedWarnings,
    floatingHolidayBalance,
    history,
  } = data;

  const period = card.pay_periods;
  const isExported = card.status === "exported";
  const editable = canEdit && !isExported;

  const entriesByDate = new Map<string, any[]>();
  for (const e of entries) {
    const list = entriesByDate.get(e.work_date) ?? [];
    list.push(e);
    entriesByDate.set(e.work_date, list);
  }

  const dayMetaByDate = new Map<string, any>();
  for (const d of days) dayMetaByDate.set(d.work_date, d);

  const pendingDays = salariedDays.filter((d: any) => d.status === "pending");
  const summary = salariedSummary ?? {
    scheduled_days: 0,
    confirmed_days: 0,
    exception_days: 0,
    pending_days: 0,
    time_off_hours: 0,
    holiday_hours: 0,
    actual_worked: 0,
    base_period_hours: 80,
  };

  function onConfirmRemaining() {
    startTransition(async () => {
      const res = await confirmRemainingDays(card.id);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        setNotice(res.message ?? null);
        router.refresh();
      }
    });
  }

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {viewingName ? `${viewingName}'s time` : "My time"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {fmtRange(period.start_date, period.end_date)} · Salaried
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

          <a
            href={`/print?timecard=${card.id}`}
            target="_blank"
            rel="noopener"
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Print
          </a>

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
            computer or connect to the location WiFi.
          </p>
        </div>
      )}

      <Panel
        title="This period"
        description="You are paid 80 hours per period. Record time off and any holiday work; confirm the rest."
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Base hours" value={Number(summary.base_period_hours)} />
          <Stat
            label="Time off"
            value={Number(summary.time_off_hours)}
            muted={Number(summary.time_off_hours) === 0}
          />
          <Stat
            label="Days confirmed"
            value={`${summary.confirmed_days + summary.exception_days} / ${summary.scheduled_days}`}
          />
          <Stat
            label="Needs attention"
            value={summary.pending_days}
            tone={summary.pending_days > 0 ? "warn" : undefined}
          />
        </div>

        {floatingHolidayBalance > 0 && (
          <p className="mt-4 border-t border-[var(--line)] pt-3 text-sm text-[var(--muted)]">
            Floating holiday balance:{" "}
            <span className="font-medium tabular-nums text-[var(--ink)]">
              {floatingHolidayBalance}h
            </span>
          </p>
        )}
      </Panel>

      {pendingDays.length > 0 && editable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-900">
                {pendingDays.length} day{pendingDays.length === 1 ? "" : "s"} not yet
                confirmed
              </p>
              <p className="mt-1 text-sm text-amber-800">
                If you worked these normally, confirm them all at once. Days with time
                off or holiday work are left alone.
              </p>
            </div>
            <Button onClick={onConfirmRemaining} disabled={pending}>
              {pending ? "Confirming…" : "Confirm remaining days"}
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {holidaySummary.some((h: any) => Number(h.excess_hours) > 0) && (
        <HolidayElections
          timecardId={card.id}
          summary={holidaySummary}
          conversions={conversions}
          isSalaried={true}
          editable={editable}
        />
      )}

      <RangeTimeOff
        timecardId={card.id}
        codes={codes}
        periodStart={period.start_date}
        periodEnd={period.end_date}
        editable={editable}
      />

      <Panel title="Days">
        <div className="space-y-2">
          {salariedDays.map((day: any) => (
            <SalariedDayRow
              key={day.work_date}
              timecardId={card.id}
              day={day}
              entries={entriesByDate.get(day.work_date) ?? []}
              meta={dayMetaByDate.get(day.work_date)}
              codes={codes}
              editable={editable}
              label={fmtDate(day.work_date)}
            />
          ))}
        </div>
      </Panel>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <TimecardHistory history={history} isOwnCard={isOwnCard} />

      {isOwnCard && !isExported && (
        <Panel title="Approval">
          {card.status === "open" ? (
            <div className="space-y-3">
              {summary.pending_days > 0 ? (
                <p className="text-sm text-amber-800">
                  {summary.pending_days} day
                  {summary.pending_days === 1 ? "" : "s"} still unconfirmed. You can
                  approve anyway, but confirming first makes the card clearer for your
                  supervisor.
                </p>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  Approving confirms your time is complete and correct. You can still
                  make changes afterward — your supervisor approves last.
                </p>
              )}
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

function Stat({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: number | string;
  muted?: boolean;
  tone?: "warn";
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "warn"
            ? "text-amber-700"
            : muted
            ? "text-[var(--muted)]"
            : ""
        }`}
      >
        {value}
      </p>
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
