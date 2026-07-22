"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateSemiMonthlyYear,
  generateBiWeeklySeason,
  deletePayPeriod,
} from "@/lib/actions/pay-periods";
import {
  Panel,
  Button,
  Badge,
  Table,
  Empty,
  Field,
  inputClass,
  selectClass,
} from "@/components/ui";

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function dayName(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

/** Next Sunday on or after a date — bi-weekly must start on Sunday. */
function nextSunday(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const shift = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + shift);
  return d.toISOString().slice(0, 10);
}

export default function PayPeriodManager({
  payrollType,
  periods,
  coverage,
  seasons,
}: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  const thisYear = new Date().getFullYear();
  const covered = new Set(coverage.map((c: any) => Number(c.year)));
  // offer the first year that isn't fully covered
  let suggestYear = thisYear;
  while (covered.has(suggestYear)) suggestYear++;

  const [year, setYear] = useState(suggestYear);
  const [seasonStart, setSeasonStart] = useState(
    nextSunday(new Date().toISOString().slice(0, 10))
  );
  const [seasonCount, setSeasonCount] = useState(14);

  function switchPayroll(type: string) {
    router.push(`/admin/pay-periods?payroll=${type}`);
  }

  function onGenerateYear() {
    startTransition(async () => {
      const res = await generateSemiMonthlyYear(year);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  function onGenerateSeason() {
    startTransition(async () => {
      const res = await generateBiWeeklySeason(seasonStart, seasonCount);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  function onDelete(id: string, label: string) {
    if (!confirm(`Delete the ${label} pay period?`)) return;
    startTransition(async () => {
      const res = await deletePayPeriod(id);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      router.refresh();
    });
  }

  const startsOnSunday = dayName(seasonStart) === "Sun";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Pay periods</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {periods.length} period{periods.length === 1 ? "" : "s"} on file
          </p>
        </div>

        <select
          value={payrollType}
          onChange={(e) => switchPayroll(e.target.value)}
          className={selectClass + " w-auto py-2 text-sm"}
        >
          <option value="semi_monthly">Semi-monthly</option>
          <option value="bi_weekly">Bi-weekly</option>
        </select>
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

      {payrollType === "semi_monthly" ? (
        <Panel
          title="Generate a year"
          description="Semi-monthly dates never vary — 11th through 25th, and 26th through the 10th. A whole year is created at once."
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-32">
              <Field label="Year">
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  min={2000}
                  max={2100}
                  className={inputClass}
                />
              </Field>
            </div>
            <Button onClick={onGenerateYear} disabled={pending}>
              {pending ? "Generating…" : `Generate ${year}`}
            </Button>
          </div>

          {coverage.length > 0 && (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
                Years on file
              </p>
              <div className="flex flex-wrap gap-2">
                {coverage.map((c: any) => (
                  <Badge key={c.year} tone={c.complete ? "good" : "warn"}>
                    {c.year}
                    {!c.complete && ` (${c.period_count}/24)`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Panel>
      ) : (
        <Panel
          title="Generate a season"
          description="Bi-weekly has no fixed anchor — the season starts when the first bi-weekly employee starts, which varies year to year."
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-48">
              <Field
                label="First period starts"
                hint={
                  startsOnSunday
                    ? undefined
                    : `${dayName(seasonStart)} — must be a Sunday`
                }
              >
                <input
                  type="date"
                  value={seasonStart}
                  onChange={(e) => setSeasonStart(e.target.value)}
                  className={
                    inputClass +
                    (startsOnSunday ? "" : " border-amber-400 bg-amber-50")
                  }
                />
              </Field>
            </div>

            {!startsOnSunday && (
              <button
                type="button"
                onClick={() => setSeasonStart(nextSunday(seasonStart))}
                className="pb-2.5 text-sm text-[var(--accent)] hover:underline"
              >
                Use {fmt(nextSunday(seasonStart))}
              </button>
            )}

            <div className="w-32">
              <Field label="How many">
                <input
                  type="number"
                  value={seasonCount}
                  onChange={(e) => setSeasonCount(Number(e.target.value))}
                  min={1}
                  max={40}
                  className={inputClass}
                />
              </Field>
            </div>

            <Button
              onClick={onGenerateSeason}
              disabled={pending || !startsOnSunday}
            >
              {pending ? "Generating…" : "Generate season"}
            </Button>
          </div>

          <p className="mt-3 text-xs text-[var(--muted)]">
            {seasonCount} periods covers about {Math.round((seasonCount * 14) / 7)}{" "}
            weeks, through{" "}
            {fmt(
              new Date(
                new Date(seasonStart + "T00:00:00").getTime() +
                  (seasonCount * 14 - 1) * 86400000
              )
                .toISOString()
                .slice(0, 10)
            )}
            .
          </p>

          {seasons.length > 0 && (
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
                Seasons on file
              </p>
              <ul className="space-y-1 text-sm">
                {seasons.map((s: any, i: number) => (
                  <li key={i}>
                    {fmt(s.season_start)} – {fmt(s.season_end)}
                    <span className="ml-2 text-[var(--muted)]">
                      {s.period_count} periods
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      <Panel title="All periods">
        {periods.length === 0 ? (
          <Empty>No periods yet. Generate some above.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Timecards</th>
                <th className="py-2 pr-4 font-medium">Entries</th>
                <th className="py-2 font-medium"></th>
              </>
            }
          >
            {periods.map((p: any) => (
              <tr
                key={p.id}
                className={`border-b border-[var(--line)] last:border-0 ${
                  p.is_current ? "bg-emerald-50/40" : ""
                }`}
              >
                <td className="py-3 pr-4">
                  {fmt(p.start_date)} – {fmt(p.end_date)}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap gap-1">
                    {p.is_current && <Badge tone="good">Current</Badge>}
                    {p.is_future && <Badge tone="neutral">Upcoming</Badge>}
                    {p.exported_at && <Badge tone="good">Exported</Badge>}
                    {p.locked_at && !p.exported_at && <Badge tone="warn">Locked</Badge>}
                  </div>
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {p.timecard_count || <span className="text-[var(--muted)]">—</span>}
                </td>
                <td className="py-3 pr-4 tabular-nums">
                  {p.entry_count || <span className="text-[var(--muted)]">—</span>}
                </td>
                <td className="py-3">
                  {p.can_delete ? (
                    <button
                      onClick={() =>
                        onDelete(p.id, `${fmt(p.start_date)} – ${fmt(p.end_date)}`)
                      }
                      disabled={pending}
                      className="text-sm text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">in use</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
