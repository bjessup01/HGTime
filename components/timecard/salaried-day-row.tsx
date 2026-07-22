"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addEntry,
  deleteEntry,
  confirmSalariedDay,
} from "@/lib/actions/timecard";
import { Button, Badge, inputClass, selectClass } from "@/components/ui";

export default function SalariedDayRow({
  timecardId,
  day,
  entries,
  meta,
  codes,
  editable,
  label,
}: any) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"time_off" | "work">("time_off");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const notEmployed = day.status === "not_employed";
  const notScheduled = day.status === "not_scheduled";
  const isPending = day.status === "pending";
  const isConfirmed = day.status === "confirmed";
  const hasEntries = entries.length > 0;
  const isHoliday = Number(day.holiday_hours) > 0;

  function onToggleConfirm() {
    startTransition(async () => {
      const res = await confirmSalariedDay(timecardId, day.work_date, !isConfirmed);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

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

  return (
    <div
      className={`rounded-lg border p-3 ${
        notEmployed
          ? "border-[var(--line)] bg-[var(--bg)] opacity-50"
          : isPending
          ? "border-amber-300 bg-amber-50/50"
          : notScheduled
          ? "border-dashed border-[var(--line)] bg-[var(--bg)]/40"
          : isConfirmed && !hasEntries
          ? "border-emerald-200 bg-emerald-50/30"
          : "border-[var(--line)] bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-24 shrink-0">
          <span
            className={`text-sm ${
              notEmployed || notScheduled ? "text-[var(--muted)]" : "font-medium"
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
          {!notEmployed && notScheduled && !isHoliday && (
            <span className="text-xs text-[var(--muted)]">not scheduled</span>
          )}
          {!notEmployed && day.is_scheduled_day && !hasEntries && (
            <span className="text-xs text-[var(--muted)]">
              {Number(day.scheduled_hours)}h scheduled
            </span>
          )}
          {isConfirmed && !hasEntries && <Badge tone="good">Confirmed</Badge>}
          {isPending && (
            <span className="text-xs text-amber-800">not yet confirmed</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {editable && !notEmployed && day.is_scheduled_day && !hasEntries && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isConfirmed}
                onChange={onToggleConfirm}
                disabled={pending}
                className="h-4 w-4"
              />
              <span className={isConfirmed ? "text-[var(--muted)]" : ""}>
                Worked as scheduled
              </span>
            </label>
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

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

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
              onClick={() => setMode("time_off")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === "time_off"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-white"
              }`}
            >
              Time off
            </button>
            <button
              type="button"
              onClick={() => setMode("work")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === "work"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-white"
              }`}
            >
              {isHoliday ? "Worked the holiday" : "Record hours worked"}
            </button>
          </div>

          {mode === "time_off" ? (
            <>
              <select name="time_off_code_id" required className={selectClass}>
                <option value="">Choose a time-off code…</option>
                {codes.timeOffCodes.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </select>

              <div className="flex items-end gap-3">
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
                <p className="pb-2.5 text-xs text-[var(--muted)]">
                  Full day is {Number(day.scheduled_hours)}h. Enter less for a partial
                  day and confirm the rest as worked.
                </p>
              </div>
            </>
          ) : (
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

              {isHoliday && (
                <p className="text-xs text-[var(--muted)]">
                  Hours worked on a holiday earn floating holiday time and reduce the
                  holiday hours for this day.
                </p>
              )}
            </>
          )}

          <input
            name="note"
            placeholder="Note (optional)"
            className={inputClass + " text-sm"}
          />

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
