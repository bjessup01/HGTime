import { supabaseServer } from "@/lib/supabase";

export type PrintCard = {
  header: any;
  notes: { work_date: string; note_type: string; note_text: string }[];
  codesUsed: { code: string; description: string }[];
  workLines: any[];
  timeOffLines: any[];
  weeks: any[];
  totals: {
    hoursWorked: number;
    timeOff: number;
    total: number;
    regular: number;
    overtime: number;
    vacation: number;
    sick: number;
    other: number;
  };
};

function round(n: number) {
  return Math.round(Number(n ?? 0) * 100) / 100;
}

/** Assemble everything one printed card needs. */
export async function loadPrintCard(timecardId: string): Promise<PrintCard | null> {
  const sb = supabaseServer();

  const [
    { data: header },
    { data: codesUsed },
    { data: workLines },
    { data: timeOffLines },
    { data: weeks },
    { data: notes },
  ] = await Promise.all([
    sb.rpc("print_header", { p_timecard_id: timecardId }),
    sb.rpc("print_codes_used", { p_timecard_id: timecardId }),
    sb.rpc("print_work_lines", { p_timecard_id: timecardId }),
    sb.rpc("print_time_off_lines", { p_timecard_id: timecardId }),
    sb.rpc("print_week_summary", { p_timecard_id: timecardId }),
    sb.rpc("print_notes", { p_timecard_id: timecardId }),
  ]);

  const h = (header as any[])?.[0];
  if (!h) return null;

  const work = (workLines as any[]) ?? [];
  const off = (timeOffLines as any[]) ?? [];
  const wk = (weeks as any[]) ?? [];

  // Prior-period rows are shown for overtime context only and are
  // excluded from this period's totals.
  const hoursWorked = work
    .filter((l) => !l.is_prior)
    .reduce((s, l) => s + Number(l.hours), 0);

  const timeOff = off.reduce((s, l) => s + Number(l.hours), 0);

  const bucket = (b: string) =>
    off.filter((l) => l.bucket === b).reduce((s, l) => s + Number(l.hours), 0);

  const regular = wk.reduce((s, w) => s + Number(w.regular), 0);
  const overtime = wk.reduce((s, w) => s + Number(w.overtime), 0);

  return {
    header: h,
    notes: (notes as any[]) ?? [],
    codesUsed: (codesUsed as any[]) ?? [],
    workLines: work,
    timeOffLines: off,
    weeks: wk,
    totals: {
      hoursWorked: round(hoursWorked),
      timeOff: round(timeOff),
      // Salaried are always paid 80 regardless of hours recorded.
      total: h.is_salaried ? 80 : round(hoursWorked + timeOff),
      regular: round(regular),
      overtime: round(overtime),
      vacation: round(bucket("vacation")),
      sick: round(bucket("sick")),
      other: round(bucket("other")),
    },
  };
}

/** Timecards to print for a period. */
export async function loadPrintQueue(
  payPeriodId: string,
  onlyApproved: boolean
) {
  const sb = supabaseServer();
  const { data } = await sb.rpc("print_queue", {
    p_pay_period_id: payPeriodId,
    p_only_approved: onlyApproved,
  });
  return (data as any[]) ?? [];
}
