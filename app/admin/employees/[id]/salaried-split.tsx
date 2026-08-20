"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel, Button, selectClass, inputClass } from "@/components/ui";
import { setSalariedSplit } from "@/lib/actions/admin";

type Line = { work_code_id: string; percent: string };

export default function SalariedSplit({
  employeeId,
  isSalaried,
  workCodes,
  split,
}: {
  employeeId: string;
  isSalaried: boolean;
  workCodes: any[];
  split: any[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(
    null
  );

  const [lines, setLines] = useState<Line[]>(
    split.length > 0
      ? split.map((s: any) => ({
          work_code_id: s.work_code_id,
          percent: String(Number(s.percent)),
        }))
      : [
          { work_code_id: "", percent: "" },
          { work_code_id: "", percent: "" },
        ]
  );

  const total = lines.reduce((s, l) => s + (Number(l.percent) || 0), 0);
  const enabled = split.length > 0 || lines.some((l) => l.work_code_id);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { work_code_id: "", percent: "" }]);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, j) => j !== i));
  }

  function save() {
    setMessage(null);
    const filled = lines.filter((l) => l.work_code_id && l.percent);
    if (filled.length > 0 && filled.length < 2) {
      setMessage({ error: "A split needs at least two work codes." });
      return;
    }
    if (filled.length > 0 && Math.round(total * 100) / 100 !== 100) {
      setMessage({ error: `Percentages must sum to 100 (currently ${total}).` });
      return;
    }
    start(async () => {
      const res = await setSalariedSplit(
        employeeId,
        filled.map((l) => ({
          work_code_id: l.work_code_id,
          percent: Number(l.percent),
        }))
      );
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
      if (res.ok) router.refresh();
    });
  }

  function clearSplit() {
    start(async () => {
      const res = await setSalariedSplit(employeeId, []);
      setMessage(res.ok ? { ok: "Split cleared." } : { error: res.error });
      if (res.ok) {
        setLines([
          { work_code_id: "", percent: "" },
          { work_code_id: "", percent: "" },
        ]);
        router.refresh();
      }
    });
  }

  if (!isSalaried) return null;

  return (
    <Panel
      title="Work-code split"
      description="Splits the flat 80 salaried hours across two or more work codes at fixed percentages. Leave empty for a single default-code line."
    >
      <div className="space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={l.work_code_id}
              onChange={(e) => setLine(i, { work_code_id: e.target.value })}
              className={selectClass + " flex-1"}
            >
              <option value="">Choose a work code…</option>
              {workCodes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.description}
                </option>
              ))}
            </select>
            <div className="flex w-28 items-center gap-1">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={l.percent}
                onChange={(e) => setLine(i, { percent: e.target.value })}
                className={inputClass}
                placeholder="%"
              />
              <span className="text-sm text-[var(--muted)]">%</span>
            </div>
            {lines.length > 2 && (
              <button
                onClick={() => removeLine(i)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between">
          <button
            onClick={addLine}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            + Add another code
          </button>
          <span
            className={`text-sm tabular-nums ${
              Math.round(total * 100) / 100 === 100
                ? "text-emerald-700"
                : "text-[var(--muted)]"
            }`}
          >
            Total: {Math.round(total * 100) / 100}%
          </span>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save split"}
          </Button>
          {enabled && (
            <Button variant="secondary" onClick={clearSplit} disabled={pending}>
              Clear split
            </Button>
          )}
        </div>

        {message?.ok && (
          <p className="text-sm text-emerald-700">{message.ok}</p>
        )}
        {message?.error && (
          <p className="text-sm text-red-700">{message.error}</p>
        )}

        <p className="text-xs text-[var(--muted)]">
          Example: 25% and 75% of 80 hours prints as 20.00 and 60.00. The split
          is the same every period and does not change with time off — salaried
          always exports 80 hours.
        </p>
      </div>
    </Panel>
  );
}
