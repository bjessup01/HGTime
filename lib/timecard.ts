import { supabaseServer } from "@/lib/supabase";
import type { Entry } from "@/lib/timecard-calc";

export type { Entry } from "@/lib/timecard-calc";
export { summarize, weeklyTotals, weekStart } from "@/lib/timecard-calc";

export type DayScaffold = {
  work_date: string;
  dow: number;
  scheduled_hours: number;
  is_scheduled_day: boolean;
  holiday_id: string | null;
  holiday_name: string | null;
  holiday_hours: number;
  is_holiday_observed: boolean;
};

export type Warning = { work_date: string; kind: string; message: string };

export type HolidaySummary = {
  work_date: string;
  holiday_name: string;
  holiday_hours: number;
  worked_hours: number;
  remaining_holiday: number;
  election: "floating_holiday" | "double_time" | null;
  needs_election: boolean;
};

export type ConversionCheck = {
  week_start: string;
  holiday_date: string;
  holiday_name: string;
  holiday_hours: number;
  days_worked: number;
  converts: boolean;
  friday_worked: boolean;
};

export type SalariedDay = {
  work_date: string;
  scheduled_hours: number;
  is_scheduled_day: boolean;
  is_employed: boolean;
  holiday_hours: number;
  holiday_name: string | null;
  entry_hours: number;
  worked_hours: number;
  time_off_hours: number;
  confirmed: boolean;
  status: "confirmed" | "exception" | "pending" | "not_scheduled" | "not_employed";
};

export type OtPreview = {
  week_start: string;
  week_total: number;
  prior_regular: number;
  prior_ot: number;
  this_regular: number;
  this_ot: number;
  is_split_week: boolean;
  settles_here: boolean;
};

export type TimecardDay = {
  timecard_id: string;
  work_date: string;
  shuttle_level_id: string | null;
  holiday_election: "floating_holiday" | "double_time" | null;
  salaried_confirmed: boolean;
};

export type PayPeriod = {
  id: string;
  payroll_type: "semi_monthly" | "bi_weekly";
  start_date: string;
  end_date: string;
  locked_at: string | null;
  exported_at: string | null;
};

/** The pay period containing today for a payroll type, else the most recent. */
export async function currentPayPeriod(
  payrollType: "semi_monthly" | "bi_weekly"
): Promise<PayPeriod | null> {
  const sb = supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  const { data: containing } = await sb
    .from("pay_periods")
    .select("*")
    .eq("payroll_type", payrollType)
    .lte("start_date", today)
    .gte("end_date", today)
    .maybeSingle();

  if (containing) return containing as PayPeriod;

  const { data: recent } = await sb
    .from("pay_periods")
    .select("*")
    .eq("payroll_type", payrollType)
    .lte("start_date", today)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (recent as PayPeriod) ?? null;
}

/** Recent periods for the period picker. */
export async function recentPayPeriods(
  payrollType: "semi_monthly" | "bi_weekly",
  limit = 8
): Promise<PayPeriod[]> {
  const sb = supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await sb
    .from("pay_periods")
    .select("*")
    .eq("payroll_type", payrollType)
    .lte("start_date", today)
    .order("start_date", { ascending: false })
    .limit(limit);

  return (data as PayPeriod[]) ?? [];
}

export async function loadTimecard(timecardId: string) {
  const sb = supabaseServer();

  const { data: card } = await sb
    .from("timecards")
    .select("*, pay_periods(*)")
    .eq("id", timecardId)
    .maybeSingle();

  if (!card) return null;

  // Fetched separately: timecards has three foreign keys to employees
  // (employee_id, employee_approved_by, supervisor_approved_by), so an
  // embedded select is ambiguous and returns nothing.
  const { data: employee } = await sb
    .from("employees")
    .select("id, first_name, last_name, employee_number, shuttle_eligible")
    .eq("id", card.employee_id)
    .maybeSingle();

  (card as any).employees = employee;

  const [
    { data: scaffold },
    { data: entries },
    { data: days },
    { data: warnings },
    { data: holidaySummary },
    { data: conversions },
    { data: otPreview },
    { data: fhBalance },
    { data: salariedDays },
    { data: salariedSummary },
    { data: salariedWarnings },
    { data: history },
  ] = await Promise.all([
    sb.rpc("timecard_days_scaffold", {
      p_employee_id: card.employee_id,
      p_pay_period_id: card.pay_period_id,
    }),
    sb
      .from("timecard_entries")
      .select(
        "*, work_codes(code, description), time_off_codes(code, description, bucket)"
      )
      .eq("timecard_id", timecardId)
      .order("work_date")
      .order("created_at"),
    sb.from("timecard_days").select("*").eq("timecard_id", timecardId),
    sb.rpc("timecard_warnings", { p_timecard_id: timecardId }),
    sb.rpc("holiday_work_summary", { p_timecard_id: timecardId }),
    sb.rpc("holiday_conversion_check", { p_timecard_id: timecardId }),
    sb.rpc("timecard_ot_preview", { p_timecard_id: timecardId }),
    sb.rpc("floating_holiday_balance", { p_employee_id: card.employee_id }),
    sb.rpc("salaried_day_status", { p_timecard_id: timecardId }),
    sb.rpc("salaried_summary", { p_timecard_id: timecardId }),
    sb.rpc("salaried_warnings", { p_timecard_id: timecardId }),
    sb.rpc("timecard_history", {
      p_timecard_id: timecardId,
      p_include_system: false,
    }),
  ]);

  return {
    card,
    scaffold: (scaffold as DayScaffold[]) ?? [],
    entries: (entries as Entry[]) ?? [],
    days: (days as TimecardDay[]) ?? [],
    warnings: (warnings as Warning[]) ?? [],
    holidaySummary: (holidaySummary as HolidaySummary[]) ?? [],
    conversions: (conversions as ConversionCheck[]) ?? [],
    otPreview: (otPreview as OtPreview[]) ?? [],
    floatingHolidayBalance: Number(fhBalance ?? 0),
    salariedDays: (salariedDays as SalariedDay[]) ?? [],
    salariedSummary: (salariedSummary as any[])?.[0] ?? null,
    salariedWarnings: (salariedWarnings as Warning[]) ?? [],
    history: (history as any[]) ?? [],
  };
}

/** Work and time-off codes this employee may use. */
export async function loadEmployeeCodes(employeeId: string) {
  const sb = supabaseServer();

  const [
    { data: workCodes },
    { data: timeOffCodes },
    { data: shuttleLevels },
    { data: assignment },
  ] = await Promise.all([
    sb
      .from("employee_work_codes")
      .select("work_codes(id, code, description)")
      .eq("employee_id", employeeId),
    sb
      .from("employee_time_off_codes")
      .select(
        "time_off_codes(id, code, description, bucket, requires_zero_hours, payroll_admin_only)"
      )
      .eq("employee_id", employeeId),
    sb
      .from("shuttle_incentive_levels")
      .select("*")
      .eq("active", true)
      .order("sort_order"),
    sb
      .from("employee_current")
      .select("default_work_code_id")
      .eq("id", employeeId)
      .maybeSingle(),
  ]);

  return {
    workCodes: (workCodes ?? [])
      .map((r: any) => r.work_codes)
      .filter(Boolean)
      .sort((a: any, b: any) => a.code.localeCompare(b.code)),
    // Admin-only codes never appear in the employee's picker.
    timeOffCodes: (timeOffCodes ?? [])
      .map((r: any) => r.time_off_codes)
      .filter((c: any) => c && !c.payroll_admin_only),
    shuttleLevels: shuttleLevels ?? [],
    defaultWorkCodeId: assignment?.default_work_code_id ?? null,
  };
}