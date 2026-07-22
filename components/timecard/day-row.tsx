"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addEntry,
  deleteEntry,
  setShuttleIncentive,
} from "@/lib/actions/timecard";
import { Button, Badge, inputClass, selectClass } from "@/components/ui";

export default function DayRow({
  timecardId,
  day,
  entries,
  meta,
  warnings,
  codes,
  editable,
  isSalaried,
  shuttleEligible,
  label,
}: any) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"work" | "time_off">("work");
  const [useClock, setUseClock] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dayTotal = entries.reduce((s: number, e: any) => s + Number(e.hours), 0);
  const hasWarning = warnings.length > 0;
  const notEmployed = day.is_employed === false;
  const isUnscheduled = !day.is_scheduled_day && !notEmployed;
  const isHoliday = day.is_holiday_observed || day.holiday_hours > 0;

  function onAdd(formData: FormData) {
    startTransition(async () => {
      const res = await addEntry(formData);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const res = await deleteEntry(id);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  function onShuttle(levelId: string) {
    startTransition(async () => {
      await setShuttleIncentive(timecardId, day.work_date, levelId || null);
      router.refresh();
    });
  }

  return (
    <div
      className={`rounded-lg border p-3 ${
        notEmployed
          ? "border-[var(--line)] bg-[var(--bg)] opacity-50"
          : hasWarning
          ? "border-amber-300 bg-amber-50/50"
          : isUnscheduled
          ? "border-dashed border-[var(--line)] bg-[var(--bg)]/40"
          : "border-[var(--line)] bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-24 shrink-0">
          <span
            className={`text-sm ${
              notEmployed || isUnscheduled ? "text-[var(--muted)]" : "font-medium"
            }`}
          >
            {label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {notEmployed && (
            <span className="text-xs text-[var(--muted)]">not employed</span>
          )}
          {!notEmployed && isHoliday && day.holiday_name && (
            <Badge tone="good">{day.holiday_name}</Badge>
          )}
          {!notEmployed && isUnscheduled && !isHoliday && (
            <span className="text-xs text-[var(--muted)]">not scheduled</span>
          )}
          {!notEmployed && day.is_scheduled_day && (
            <span className="text-xs text-[var(--muted)]">
              {Number(day.scheduled_hours)}h scheduled
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {dayTotal > 0 && (
            <span className="text-sm font-medium tabular-nums">
              {round(dayTotal)}h
            </span>
          )}
          {editable && !adding && !notEmployed && (
            <button
              onClick={() => setAdding(true)}
              className="text-sm text-[var(--accent)] hover:underline"
            >
              + Add
            </button>
          )}
        </div>
      </div>

      {warnings.map((w: any, i: number) => (
        <p key={i} className="mt-2 text-xs text-amber-800">
          {w.message}
        </p>
      ))}

      {entries.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {entries.map((e: any) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--bg)] px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs font-semibold">
                {e.kind === "work"
                  ? e.work_codes?.code ?? "—"
                  : e.time_off_codes?.code ?? "—"}
              </span>

              <span className="text-[var(--muted)]">
                {e.kind === "work"
                  ? e.work_codes?.description
                  : e.time_off_codes?.description}
              </span>

              {e.start_time && e.end_time && (
                <span className="text-xs text-[var(--muted)]">
                  {e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}
                </span>
              )}

              {e.double_time && <Badge tone="warn">Double time</Badge>}
              {e.unpaid && <Badge>Unpaid</Badge>}
              {e.system_generated && <Badge tone="neutral">auto</Badge>}
              {e.note && (
                <span className="text-xs italic text-[var(--muted)]">{e.note}</span>
              )}

              <span className="ml-auto tabular-nums">{Number(e.hours)}h</span>

              {editable && !e.system_generated && (
                <button
                  onClick={() => onDelete(e.id)}
                  disabled={pending}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {shuttleEligible &&
        codes.shuttleLevels.length > 0 &&
        editable &&
        !notEmployed && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-[var(--muted)]">Shuttle incentive:</span>
            <select
              value={meta?.shuttle_level_id ?? ""}
              onChange={(e) => onShuttle(e.target.value)}
              disabled={pending}
              className="rounded border border-[var(--line)] bg-white px-2 py-1 text-xs"
            >
              <option value="">none</option>
              {codes.shuttleLevels.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.label} — {l.criteria}
                </option>
              ))}
            </select>
          </div>
        )}

      {adding && (
        <form
          action={onAdd}
          className="mt-3 space-y-3 rounded-md border border-[var(--line)] bg-white p-3"
        >
          <input type="hidden" name="timecard_id" value={timecardId} />
          <input type="hidden" name="work_date" value={day.work_date} />
          <input type="hidden" name="kind" value={mode} />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("work")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === "work"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-white"
              }`}
            >
              Worked
            </button>
            <button
              type="button"
              onClick={() => setMode("time_off")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === "time_off"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-white"
              }`}
            >
              Time off
            </button>
          </div>

          {mode === "work" ? (
            <>
              <select
                name="work_code_id"
                required
                defaultValue={codes.defaultWorkCodeId ?? ""}
                className={selectClass}
              >
                <option value="">Choose a work code…</option>
                {codes.workCodes.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </select>

              {!useClock ? (
                <div className="flex items-end gap-3">
                  <div className="w-32">
                    <label className="mb-1 block text-xs font-medium">Hours</label>
                    <input
                      name="hours"
                      type="number"
                      step="0.25"
                      min="0"
                      required
                      autoFocus
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseClock(true)}
                    className="pb-2.5 text-sm text-[var(--accent)] hover:underline"
                  >
                    Use start/end times
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-36">
                    <label className="mb-1 block text-xs font-medium">Start</label>
                    <input
                      name="start_time"
                      type="time"
                      required
                      className={inputClass}
                    />
                  </div>
                  <div className="w-36">
                    <label className="mb-1 block text-xs font-medium">End</label>
                    <input
                      name="end_time"
                      type="time"
                      required
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseClock(false)}
                    className="pb-2.5 text-sm text-[var(--accent)] hover:underline"
                  >
                    Enter hours instead
                  </button>
                  <p className="w-full text-xs text-[var(--muted)]">
                    Add a separate entry for each block of time — lunch is not
                    deducted automatically.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <select name="time_off_code_id" required className={selectClass}>
                <option value="">Choose a time-off code…</option>
                {codes.timeOffCodes.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </select>

              <div className="w-32">
                <label className="mb-1 block text-xs font-medium">Hours</label>
                <input
                  name="hours"
                  type="number"
                  step="0.25"
                  min="0"
                  defaultValue={day.scheduled_hours || ""}
                  className={inputClass}
                />
              </div>
            </>
          )}

          <input
            name="note"
            placeholder="Note (optional)"
            className={inputClass + " text-sm"}
          />

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add entry"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}