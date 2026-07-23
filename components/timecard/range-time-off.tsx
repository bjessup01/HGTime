"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewRangeTimeOff,
  applyRangeTimeOff,
} from "@/lib/actions/timecard";
import { Panel, Button, Field, inputClass, selectClass } from "@/components/ui";

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function RangeTimeOff({
  timecardId,
  codes,
  periodStart,
  periodEnd,
  editable,
}: any) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [from, setFrom] = useState(periodStart);
  const [to, setTo] = useState(periodStart);
  const [codeId, setCodeId] = useState("");
  const [note, setNote] = useState("");

  const [preview, setPreview] = useState<any[] | null>(null);
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  if (!editable) return null;

  function onPreview() {
    startTransition(async () => {
      const res = await previewRangeTimeOff(timecardId, from, to);
      if (res.ok) {
        setPreview(res.days);
        setMessage(null);
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  function onApply() {
    if (!codeId) {
      setMessage({ error: "Choose a time-off code." });
      return;
    }
    startTransition(async () => {
      const res = await applyRangeTimeOff(timecardId, from, to, codeId, note);
      if (res.ok) {
        setMessage({ ok: res.message });
        setPreview(null);
        setOpen(false);
        setNote("");
        router.refresh();
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add time off for a date range
        </Button>
        {message?.ok && (
          <span className="text-sm text-emerald-700">{message.ok}</span>
        )}
      </div>
    );
  }

  const willApply = preview?.filter((d) => d.will_apply) ?? [];
  const skipped = preview?.filter((d) => !d.will_apply) ?? [];
  const totalHours = willApply.reduce(
    (s, d) => s + Number(d.scheduled_hours),
    0
  );

  return (
    <Panel
      title="Time off for a date range"
      description="Applies at each day's scheduled hours. Days you aren't scheduled, days that already have time, and holidays are skipped."
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setPreview(null);
            setMessage(null);
          }}
        >
          Cancel
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <Field label="From">
              <input
                type="date"
                value={from}
                min={periodStart}
                max={periodEnd}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (e.target.value > to) setTo(e.target.value);
                  setPreview(null);
                }}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="w-44">
            <Field label="Through">
              <input
                type="date"
                value={to}
                min={from}
                max={periodEnd}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPreview(null);
                }}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="min-w-[14rem] flex-1">
            <Field label="Time-off code">
              <select
                value={codeId}
                onChange={(e) => setCodeId(e.target.value)}
                className={selectClass}
              >
                <option value="">Choose…</option>
                {codes.timeOffCodes.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.description}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Button variant="secondary" onClick={onPreview} disabled={pending}>
            {pending ? "Checking…" : "Preview"}
          </Button>
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className={inputClass + " text-sm"}
        />

        {preview && (
          <div className="rounded-md border border-[var(--line)] p-4">
            {willApply.length === 0 ? (
              <p className="text-sm text-amber-800">
                Nothing to apply in this range.
              </p>
            ) : (
              <p className="text-sm">
                Will apply <strong>{totalHours}</strong> hours across{" "}
                <strong>{willApply.length}</strong> day
                {willApply.length === 1 ? "" : "s"}:{" "}
                <span className="text-[var(--muted)]">
                  {willApply
                    .map((d) => `${fmt(d.work_date)} (${Number(d.scheduled_hours)}h)`)
                    .join(", ")}
                </span>
              </p>
            )}

            {skipped.length > 0 && (
              <p className="mt-2 text-sm text-[var(--muted)]">
                Skipping{" "}
                {skipped
                  .map((d) => `${fmt(d.work_date)} — ${d.skip_reason}`)
                  .join(", ")}
              </p>
            )}

            {willApply.length > 0 && (
              <div className="mt-3">
                <Button onClick={onApply} disabled={pending || !codeId}>
                  {pending ? "Applying…" : `Apply to ${willApply.length} days`}
                </Button>
              </div>
            )}
          </div>
        )}

        {message?.error && (
          <p className="text-sm text-red-700">{message.error}</p>
        )}
      </div>
    </Panel>
  );
}
