"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { selectClass } from "@/components/ui";

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * Sets which pay period the "Enter time" links target. Persists in the
 * URL so it survives navigating into a card and back — enter a whole
 * period across the roster without re-picking it each time.
 */
export default function EntryPeriodPicker({
  periods,
  selected,
}: {
  periods: any[];
  selected?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pick(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("entryPeriod", id);
    else next.delete("entryPeriod");
    router.push(`/admin/employees?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--bg)] px-4 py-3">
      <label className="text-sm font-medium">Enter time for period:</label>
      <select
        value={selected ?? ""}
        onChange={(e) => pick(e.target.value)}
        className={selectClass + " w-auto py-1.5 text-sm"}
      >
        <option value="">Current period (default)</option>
        {periods.map((p: any) => (
          <option key={p.id} value={p.id}>
            {fmt(p.start_date)} – {fmt(p.end_date)}
            {p.payroll_type === "bi_weekly" ? " (bi-weekly)" : ""}
          </option>
        ))}
      </select>
      <span className="text-xs text-[var(--muted)]">
        The &ldquo;Enter time&rdquo; links below open this period.
      </span>
    </div>
  );
}
