"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, canEnterTimeNow } from "@/lib/auth";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Guard for every write to a timecard.
 * Checks: signed in, card exists, card not exported, and - when the
 * employee is editing their own card - that they are on an allowed network.
 */
async function guardTimecardWrite(timecardId: string): Promise<
  { ok: true; userId: string; employeeId: string } | { ok: false; error: string }
> {
  const user = await requireUser();
  const sb = supabaseServer();

  const { data: card } = await sb
    .from("timecards")
    .select("id, employee_id, status")
    .eq("id", timecardId)
    .maybeSingle();

  if (!card) return { ok: false, error: "Timecard not found." };

  if (card.status === "exported") {
    return {
      ok: false,
      error: "This timecard has been exported and can no longer be changed.",
    };
  }

  // Employees entering their own time are subject to the network restriction.
  if (card.employee_id === user.id) {
    const { allowed } = await canEnterTimeNow(user.id);
    if (!allowed) {
      return {
        ok: false,
        error:
          "Time can only be entered from a company computer or WiFi network. " +
          "Contact payroll if you need remote access.",
      };
    }
  }

  return { ok: true, userId: user.id, employeeId: card.employee_id };
}

/** Convert clock times to hours, handling a shift that crosses midnight. */
function hoursFromClock(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

/** Open (or create) the timecard for an employee in a period. */
export async function openTimecard(
  employeeId: string,
  payPeriodId: string
): Promise<{ ok: true; timecardId: string } | { ok: false; error: string }> {
  await requireUser();
  const sb = supabaseServer();

  const { data, error } = await sb.rpc("ensure_timecard", {
    p_employee_id: employeeId,
    p_pay_period_id: payPeriodId,
  });

  if (error) return { ok: false, error: error.message };

  await sb.rpc("apply_holiday_entries", { p_timecard_id: data });

  return { ok: true, timecardId: data as string };
}

/** Add a work or time-off entry. */
export async function addEntry(formData: FormData): Promise<Result> {
  const timecardId = String(formData.get("timecard_id"));
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const sb = supabaseServer();
  const kind = String(formData.get("kind")) as "work" | "time_off";
  const workDate = String(formData.get("work_date"));

  const startTime = String(formData.get("start_time") || "");
  const endTime = String(formData.get("end_time") || "");
  let hours = Number(formData.get("hours") || 0);

  if (kind === "work" && startTime && endTime) {
    hours = hoursFromClock(startTime, endTime);
  }

  if (kind === "work" && hours <= 0) {
    return { ok: false, error: "Enter hours, or a start and end time." };
  }
  if (hours < 0) return { ok: false, error: "Hours cannot be negative." };

  const timeOffCodeId =
    String(formData.get("time_off_code_id") || "") || null;

  if (kind === "time_off") {
    if (!timeOffCodeId) return { ok: false, error: "Choose a time-off code." };

    const { data: code } = await sb
      .from("time_off_codes")
      .select("requires_zero_hours")
      .eq("id", timeOffCodeId)
      .maybeSingle();

    // Leave Without Pay records 0 hours - it marks the day as accounted for.
    if (code?.requires_zero_hours) hours = 0;
  }

  const { error } = await sb.from("timecard_entries").insert({
    timecard_id: timecardId,
    work_date: workDate,
    kind,
    work_code_id:
      kind === "work" ? String(formData.get("work_code_id") || "") || null : null,
    time_off_code_id: kind === "time_off" ? timeOffCodeId : null,
    hours,
    start_time: startTime || null,
    end_time: endTime || null,
    unpaid: formData.get("unpaid") === "on",
    note: String(formData.get("note") || "") || null,
    created_by: guard.userId,
  });

  if (error) return { ok: false, error: error.message };

  // Worked hours reduce holiday pay, so re-derive after every change.
  await sb.rpc("apply_holiday_entries", { p_timecard_id: timecardId });

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateEntry(formData: FormData): Promise<Result> {
  const entryId = String(formData.get("entry_id"));
  const sb = supabaseServer();

  const { data: entry } = await sb
    .from("timecard_entries")
    .select("timecard_id")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) return { ok: false, error: "Entry not found." };

  const guard = await guardTimecardWrite(entry.timecard_id);
  if (!guard.ok) return guard;

  let hours = Number(formData.get("hours") || 0);
  const startTime = String(formData.get("start_time") || "");
  const endTime = String(formData.get("end_time") || "");

  if (startTime && endTime) hours = hoursFromClock(startTime, endTime);

  const { error } = await sb
    .from("timecard_entries")
    .update({
      hours,
      work_code_id: String(formData.get("work_code_id") || "") || null,
      start_time: startTime || null,
      end_time: endTime || null,
      note: String(formData.get("note") || "") || null,
    })
    .eq("id", entryId);

  if (error) return { ok: false, error: error.message };

  await sb.rpc("apply_holiday_entries", { p_timecard_id: entry.timecard_id });
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteEntry(entryId: string): Promise<Result> {
  const sb = supabaseServer();

  const { data: entry } = await sb
    .from("timecard_entries")
    .select("timecard_id, system_generated")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) return { ok: false, error: "Entry not found." };

  if (entry.system_generated) {
    return {
      ok: false,
      error:
        "Holiday hours are calculated automatically and cannot be deleted directly.",
    };
  }

  const guard = await guardTimecardWrite(entry.timecard_id);
  if (!guard.ok) return guard;

  const { error } = await sb.from("timecard_entries").delete().eq("id", entryId);
  if (error) return { ok: false, error: error.message };

  await sb.rpc("apply_holiday_entries", { p_timecard_id: entry.timecard_id });
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Floating holiday vs double time for hours worked on a holiday. */
export async function setHolidayElection(
  timecardId: string,
  workDate: string,
  election: "floating_holiday" | "double_time"
): Promise<Result> {
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const sb = supabaseServer();
  const { error } = await sb.from("timecard_days").upsert(
    { timecard_id: timecardId, work_date: workDate, holiday_election: election },
    { onConflict: "timecard_id,work_date" }
  );

  if (error) return { ok: false, error: error.message };

  // Double time exports as a duplicate work-code line at a doubled rate.
  await sb
    .from("timecard_entries")
    .update({ double_time: election === "double_time" })
    .eq("timecard_id", timecardId)
    .eq("work_date", workDate)
    .eq("kind", "work");

  revalidatePath("/dashboard");
  return { ok: true };
}

/** Shuttle incentive attaches to a day; employee picks, supervisor verifies. */
export async function setShuttleIncentive(
  timecardId: string,
  workDate: string,
  levelId: string | null
): Promise<Result> {
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const sb = supabaseServer();
  const { error } = await sb.from("timecard_days").upsert(
    { timecard_id: timecardId, work_date: workDate, shuttle_level_id: levelId },
    { onConflict: "timecard_id,work_date" }
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Employee approval. Warnings are advisory - approval is never blocked.
 * The card stays editable afterward; supervisor approval is the real gate.
 */
export async function approveAsEmployee(timecardId: string): Promise<Result> {
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const user = await requireUser();
  const sb = supabaseServer();

  const { error } = await sb
    .from("timecards")
    .update({
      status: "employee_approved",
      employee_approved_at: new Date().toISOString(),
      employee_approved_by: user.id,
    })
    .eq("id", timecardId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true, message: "Timecard approved." };
}

/** Employee withdraws their approval to make changes. */
export async function unapproveAsEmployee(timecardId: string): Promise<Result> {
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const sb = supabaseServer();
  const { error } = await sb
    .from("timecards")
    .update({
      status: "open",
      employee_approved_at: null,
      employee_approved_by: null,
    })
    .eq("id", timecardId)
    .eq("status", "employee_approved");

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Confirm (or unconfirm) a single salaried day as worked normally. */
export async function confirmSalariedDay(
  timecardId: string,
  workDate: string,
  confirmed: boolean
): Promise<Result> {
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const sb = supabaseServer();
  const { error } = await sb.rpc("confirm_salaried_day", {
    p_timecard_id: timecardId,
    p_work_date: workDate,
    p_confirmed: confirmed,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Confirm every remaining scheduled day at once.
 * Days already carrying time off or holiday work are skipped — those were
 * handled explicitly and should not be swept over.
 */
export async function confirmRemainingDays(
  timecardId: string
): Promise<Result & { confirmed?: number }> {
  const guard = await guardTimecardWrite(timecardId);
  if (!guard.ok) return guard;

  const sb = supabaseServer();
  const { data, error } = await sb.rpc("confirm_remaining_salaried_days", {
    p_timecard_id: timecardId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  const n = Number(data ?? 0);
  return {
    ok: true,
    confirmed: n,
    message: n === 0 ? "Nothing left to confirm." : `Confirmed ${n} day${n === 1 ? "" : "s"}.`,
  };
}
