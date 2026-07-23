"use server";

import { revalidatePath } from "next/cache";
import {
  supabaseAdmin,
  supabaseServer,
  employeeEmail,
  generatePin,
} from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

type Result = { ok: true; message?: string; pin?: string } | { ok: false; error: string };

/**
 * Create an employee: auth user (service role) + employee record,
 * first employment period, and first assignment — all atomic on the DB side.
 * Returns the generated PIN once, for the admin to hand over.
 */
export async function createEmployee(formData: FormData): Promise<Result> {
  await requireAdmin();

  const employeeNumber = String(formData.get("employee_number") || "").trim();
  const firstName = String(formData.get("first_name") || "").trim();
  const lastName = String(formData.get("last_name") || "").trim();

  if (!employeeNumber || !firstName || !lastName) {
    return { ok: false, error: "Employee number, first name, and last name are required." };
  }

  const admin = supabaseAdmin();
  const pin = generatePin();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: employeeEmail(employeeNumber),
    password: pin,
    email_confirm: true,
    user_metadata: { employee_number: employeeNumber },
  });

  if (authError || !authUser.user) {
    if (authError?.message?.toLowerCase().includes("already")) {
      return { ok: false, error: `Employee number ${employeeNumber} already has an account.` };
    }
    return { ok: false, error: authError?.message || "Could not create the account." };
  }

  const { error: provisionError } = await admin.rpc("provision_employee", {
    p_auth_user_id: authUser.user.id,
    p_employee_number: employeeNumber,
    p_first_name: firstName,
    p_last_name: lastName,
    p_role: String(formData.get("role") || "employee"),
    p_payroll_type: String(formData.get("payroll_type") || "semi_monthly"),
    p_employee_type: String(formData.get("employee_type") || "full_time_hourly"),
    p_schedule_code: String(formData.get("schedule_code") || "5x8"),
    p_default_work_code: String(formData.get("default_work_code") || "") || null,
    p_holiday_eligible: formData.get("holiday_eligible") === "on",
    p_can_enter_remotely: formData.get("can_enter_remotely") === "on",
    p_shuttle_eligible: formData.get("shuttle_eligible") === "on",
    p_hire_date: String(formData.get("hire_date") || new Date().toISOString().slice(0, 10)),
    p_effective_from: String(formData.get("effective_from") || formData.get("hire_date") || new Date().toISOString().slice(0, 10)),
  });

  if (provisionError) {
    // Roll back the orphaned auth user so the number can be reused.
    await admin.auth.admin.deleteUser(authUser.user.id);
    return { ok: false, error: provisionError.message };
  }

  revalidatePath("/admin/employees");
  return { ok: true, pin, message: `${firstName} ${lastName} created.` };
}

/** Generate a new PIN. Returned once for the admin to hand over. */
export async function resetPin(employeeId: string): Promise<Result> {
  await requireAdmin();

  const sb = supabaseServer();
  const { data: emp, error } = await sb
    .from("employees")
    .select("auth_user_id, first_name, last_name")
    .eq("id", employeeId)
    .single();

  if (error || !emp?.auth_user_id) {
    return { ok: false, error: "Employee not found or has no login account." };
  }

  const pin = generatePin();
  const admin = supabaseAdmin();
  const { error: updateError } = await admin.auth.admin.updateUserById(emp.auth_user_id, {
    password: pin,
  });

  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/admin/employees");
  return { ok: true, pin, message: `New PIN for ${emp.first_name} ${emp.last_name}.` };
}

/** Effective-dated assignment change (payroll type, employee type, schedule...). */
export async function changeAssignment(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("change_assignment", {
    p_employee_id: String(formData.get("employee_id")),
    p_effective_from: String(formData.get("effective_from")),
    p_payroll_type: String(formData.get("payroll_type")),
    p_employee_type: String(formData.get("employee_type")),
    p_schedule_code: String(formData.get("schedule_code")),
    p_default_work_code: String(formData.get("default_work_code") || "") || null,
    p_holiday_eligible: formData.get("holiday_eligible") === "on",
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/employees");
  return { ok: true, message: "Assignment updated." };
}

export async function terminateEmployee(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("terminate_employee", {
    p_employee_id: String(formData.get("employee_id")),
    p_term_date: String(formData.get("term_date")),
    p_reason: String(formData.get("term_reason") || ""),
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/employees");
  return { ok: true, message: "Employee terminated." };
}

export async function rehireEmployee(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("rehire_employee", {
    p_employee_id: String(formData.get("employee_id")),
    p_hire_date: String(formData.get("hire_date")),
    p_payroll_type: String(formData.get("payroll_type")),
    p_employee_type: String(formData.get("employee_type")),
    p_schedule_code: String(formData.get("schedule_code")),
    p_default_work_code: String(formData.get("default_work_code") || "") || null,
    p_holiday_eligible: formData.get("holiday_eligible") === "on",
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/employees");
  return { ok: true, message: "Employee rehired." };
}

/** Toggle employee-level flags that live directly on the employees row. */
export async function updateEmployeeFlags(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb
    .from("employees")
    .update({
      first_name: String(formData.get("first_name")),
      last_name: String(formData.get("last_name")),
      role: String(formData.get("role")),
      can_enter_remotely: formData.get("can_enter_remotely") === "on",
      shuttle_eligible: formData.get("shuttle_eligible") === "on",
    })
    .eq("id", String(formData.get("employee_id")));

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/employees");
  return { ok: true, message: "Employee updated." };
}

// ---------- supervisors ----------

export async function addSupervisor(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const employeeId = String(formData.get("employee_id"));
  const supervisorId = String(formData.get("supervisor_id"));

  if (employeeId === supervisorId) {
    return { ok: false, error: "An employee cannot supervise themselves." };
  }

  const { error } = await sb
    .from("supervisor_assignments")
    .insert({ employee_id: employeeId, supervisor_id: supervisorId });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "Already assigned." };
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/employees");
  return { ok: true, message: "Supervisor added." };
}

export async function removeSupervisor(employeeId: string, supervisorId: string): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb
    .from("supervisor_assignments")
    .delete()
    .eq("employee_id", employeeId)
    .eq("supervisor_id", supervisorId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/employees");
  return { ok: true, message: "Supervisor removed." };
}

// ---------- work codes ----------

export async function createWorkCode(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const code = String(formData.get("code") || "").trim().toUpperCase();
  const description = String(formData.get("description") || "").trim();

  if (!code || !description) return { ok: false, error: "Code and description are required." };

  const { error } = await sb.from("work_codes").insert({ code, description });
  if (error) {
    if (error.code === "23505") return { ok: false, error: `${code} already exists.` };
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/work-codes");
  return { ok: true, message: `${code} added.` };
}

export async function toggleWorkCode(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();
  const { error } = await sb.from("work_codes").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/work-codes");
  return { ok: true };
}

/** Which work codes an employee may use. Default code is always included. */
export async function setEmployeeWorkCodes(
  employeeId: string,
  workCodeIds: string[]
): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error: delError } = await sb
    .from("employee_work_codes")
    .delete()
    .eq("employee_id", employeeId);
  if (delError) return { ok: false, error: delError.message };

  if (workCodeIds.length) {
    const { error } = await sb
      .from("employee_work_codes")
      .insert(workCodeIds.map((work_code_id) => ({ employee_id: employeeId, work_code_id })));
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/employees");
  return { ok: true, message: "Work codes updated." };
}

export async function setEmployeeTimeOffCodes(
  employeeId: string,
  codeIds: string[]
): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error: delError } = await sb
    .from("employee_time_off_codes")
    .delete()
    .eq("employee_id", employeeId);
  if (delError) return { ok: false, error: delError.message };

  if (codeIds.length) {
    const { error } = await sb
      .from("employee_time_off_codes")
      .insert(codeIds.map((time_off_code_id) => ({ employee_id: employeeId, time_off_code_id })));
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/employees");
  return { ok: true, message: "Time-off codes updated." };
}

// ---------- network allowlist ----------

export async function addAllowedNetwork(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const location = String(formData.get("location") || "").trim();
  let cidr = String(formData.get("cidr") || "").trim();

  if (!location || !cidr) return { ok: false, error: "Location and IP are required." };

  // A bare IPv4 address becomes a /32 host route.
  if (!cidr.includes("/")) cidr = `${cidr}/32`;

  const { error } = await sb.from("network_allowlist").insert({ location, cidr });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/networks");
  return { ok: true, message: `${location} added.` };
}

export async function toggleNetwork(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();
  const { error } = await sb.from("network_allowlist").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/networks");
  return { ok: true };
}

export async function deleteNetwork(id: string): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();
  const { error } = await sb.from("network_allowlist").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/networks");
  return { ok: true };
}

/** Edit a work code — for fixing a typo made at creation. */
export async function updateWorkCode(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const code = String(formData.get("code") || "").trim().toUpperCase();
  const description = String(formData.get("description") || "").trim();

  if (!code || !description) {
    return { ok: false, error: "Code and description are required." };
  }

  const { error } = await sb.rpc("update_work_code", {
    p_id: String(formData.get("id")),
    p_code: code,
    p_description: description,
  });

  if (error) {
    if (error.code === "23505") return { ok: false, error: `${code} already exists.` };
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/work-codes");
  return { ok: true, message: `${code} updated.` };
}
