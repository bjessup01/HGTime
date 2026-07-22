/**
 * Pure timecard calculations — no server imports, safe in client components.
 * Anything touching Supabase or next/headers belongs in lib/timecard.ts.
 */

export type Entry = {
  id: string;
  work_date: string;
  kind: "work" | "time_off";
  work_code_id: string | null;
  time_off_code_id: string | null;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  double_time: boolean;
  unpaid: boolean;
  system_generated: boolean;
  note: string | null;
  work_codes?: { code: string; description: string } | null;
  time_off_codes?: { code: string; description: string; bucket: string } | null;
};

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Totals for the period, split the way payroll cares about. */
export function summarize(entries: Entry[]) {
  let worked = 0;
  let timeOff = 0;
  let holiday = 0;

  for (const e of entries) {
    if (e.kind === "work") worked += Number(e.hours);
    else {
      timeOff += Number(e.hours);
      if (e.time_off_codes?.code === "HOL") holiday += Number(e.hours);
    }
  }

  return {
    worked: round(worked),
    timeOff: round(timeOff),
    holiday: round(holiday),
    total: round(worked + timeOff),
  };
}

/** Sunday-start week key for a date string. */
export function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly totals with OT. Holiday is the only time-off code counting toward
 * the 40-hour threshold, so it is included here and other codes are not.
 *
 * Weeks straddling the period boundary are marked partial — their OT is
 * settled in the period containing the week's end (Phase 4).
 */
export function weeklyTotals(
  entries: Entry[],
  periodStart: string,
  periodEnd: string
) {
  const weeks = new Map<
    string,
    { worked: number; otEligible: number; other: number; partial: boolean }
  >();

  for (const e of entries) {
    const wk = weekStart(e.work_date);
    const row =
      weeks.get(wk) ?? { worked: 0, otEligible: 0, other: 0, partial: false };

    if (e.kind === "work") {
      row.worked += Number(e.hours);
      row.otEligible += Number(e.hours);
    } else if (e.time_off_codes?.code === "HOL") {
      row.otEligible += Number(e.hours);
    } else {
      row.other += Number(e.hours);
    }

    weeks.set(wk, row);
  }

  for (const [wk, row] of weeks) {
    const end = new Date(wk + "T00:00:00");
    end.setDate(end.getDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);
    row.partial = wk < periodStart || weekEnd > periodEnd;
  }

  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, row]) => ({
      week,
      worked: round(row.worked),
      otEligible: round(row.otEligible),
      other: round(row.other),
      regular: round(Math.min(row.otEligible, 40)),
      overtime: round(Math.max(row.otEligible - 40, 0)),
      partial: row.partial,
    }));
}
