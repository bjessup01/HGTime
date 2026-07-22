"use server";

import { redirect } from "next/navigation";
import { supabaseServer, employeeEmail, clientIp } from "@/lib/supabase";

export type AppRole = "employee" | "supervisor" | "payroll_admin";

export type CurrentUser = {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  role: AppRole;
  canEnterRemotely: boolean;
  shuttleEligible: boolean;
  payrollType: "semi_monthly" | "bi_weekly" | null;
  employeeType: string | null;
  scheduleCode: string | null;
  holidayEligible: boolean | null;
  defaultWorkCode: string | null;
};

/** Signed-in employee, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

  const { data: emp } = await sb
    .from("employees")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!emp) return null;

  const { data, error } = await sb
    .from("employee_current")
    .select("*")
    .eq("id", emp.id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    employeeNumber: data.employee_number,
    firstName: data.first_name,
    lastName: data.last_name,
    role: data.role,
    canEnterRemotely: data.can_enter_remotely,
    shuttleEligible: data.shuttle_eligible,
    payrollType: data.payroll_type,
    employeeType: data.employee_type,
    scheduleCode: data.schedule_code,
    holidayEligible: data.holiday_eligible,
    defaultWorkCode: data.default_work_code,
  };
}

/** Throws if not signed in. Use at the top of protected pages. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "payroll_admin") redirect("/dashboard");
  return user;
}

export async function requireSupervisor(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "supervisor" && user.role !== "payroll_admin") {
    redirect("/dashboard");
  }
  return user;
}

/** Employee number + 6-digit PIN. */
export async function signIn(
  _prev: unknown,
  formData: FormData
): Promise<{ error: string } | void> {
  const employeeNumber = String(formData.get("employee_number") || "").trim();
  const pin = String(formData.get("pin") || "").trim();

  if (!employeeNumber || !pin) {
    return { error: "Enter your employee number and PIN." };
  }

  const sb = supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: employeeEmail(employeeNumber),
    password: pin,
  });

  if (error) {
    // Deliberately vague: don't reveal whether the number exists.
    return { error: "Employee number or PIN is incorrect." };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const sb = supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

/**
 * May this employee enter their own time from the current network?
 * Delegates to the database so the rule lives in one place.
 * Supervisors/admins and employees flagged can_enter_remotely always pass.
 */
export async function canEnterTimeNow(
  employeeId: string
): Promise<{ allowed: boolean; ip: string | null }> {
  const ip = clientIp();
  const sb = supabaseServer();

  if (!ip) {
    // No resolvable IP — fail closed for restricted employees.
    const { data } = await sb
      .from("employees")
      .select("can_enter_remotely, role")
      .eq("id", employeeId)
      .single();
    const exempt =
      data?.can_enter_remotely ||
      data?.role === "supervisor" ||
      data?.role === "payroll_admin";
    return { allowed: Boolean(exempt), ip: null };
  }

  const { data, error } = await sb.rpc("may_enter_time", {
    p_employee_id: employeeId,
    p_ip: ip,
  });

  if (error) return { allowed: false, ip };
  return { allowed: Boolean(data), ip };
}
