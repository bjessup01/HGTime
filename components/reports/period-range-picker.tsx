"use client";

import { useState } from "react";
import { Button, inputClass, selectClass } from "@/components/ui";

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export default function PeriodRangePicker({
  periods,
  initialFrom,
  initialTo,
  initialPeriodId,
  onRun,
}: {
  periods: any[];
  initialFrom: string;
  initialTo: string;
  initialPeriodId?: string;
  onRun: (from: string, to: string, periodId?: string) => void;
}) {
  const [mode, setMode] = useState<"period" | "range">(
    initialPeriodId ? "period" : "range"
  );
  const [periodId, setPeriodId] = useState(
    initialPeriodId ?? periods[0]?.id ?? ""
  );
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function run() {
    if (mode === "period") {
      const p = periods.find((x) => x.id === periodId);
      if (p) onRun(p.start_date, p.end_date, p.id);
    } else {
      onRun(from, to);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setMode("period")}
          className={`rounded-md px-3 py-1.5 text-sm ${
            mode === "period"
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--line)] bg-white"
          }`}
        >
          By pay period
        </button>
        <button
          onClick={() => setMode("range")}
          className={`rounded-md px-3 py-1.5 text-sm ${
            mode === "range"
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--line)] bg-white"
          }`}
        >
          By date range
        </button>
      </div>

      {mode === "period" ? (
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[16rem]">
            <label className="mb-1 block text-xs font-medium">Pay period</label>
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className={selectClass}
            >
              {periods.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {fmt(p.start_date)} – {fmt(p.end_date)}
                  {p.payroll_type === "bi_weekly" ? " (bi-weekly)" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={run}>Run report</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <label className="mb-1 block text-xs font-medium">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="w-44">
            <label className="mb-1 block text-xs font-medium">Through</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button onClick={run}>Run report</Button>
        </div>
      )}
    </div>
  );
}
