"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Single balance correction. */
export async function setBalance(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("import_balance", {
    p_employee_number: String(formData.get("employee_number") || "").trim(),
    p_bank: String(formData.get("bank")),
    p_hours: Number(formData.get("hours")),
    p_as_of: String(formData.get("as_of")),
    p_source: "manual",
    p_note: String(formData.get("note") || "") || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/balances");
  revalidatePath("/dashboard");
  return { ok: true, message: "Balance recorded." };
}

/**
 * Bulk import from pasted CSV.
 *
 * Expected columns: employee_number, vacation, sick
 * A header row is detected and skipped. Blank cells are skipped rather
 * than written as zero — an employee with no vacation column keeps
 * whatever balance they already had.
 */
export async function importBalances(
  csv: string,
  asOf: string
): Promise<{ ok: true; imported: number; errors: string[] } | { ok: false; error: string }> {
  await requireAdmin();
  const sb = supabaseServer();

  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { ok: false, error: "Nothing to import." };

  // skip a header row if the first cell isn't numeric-looking
  const first = lines[0].split(",")[0]?.trim() ?? "";
  const rows = /^\d+$/.test(first) ? lines : lines.slice(1);

  let imported = 0;
  const errors: string[] = [];

  for (const [i, line] of rows.entries()) {
    const cells = line.split(",").map((c) => c.trim());
    const employeeNumber = cells[0];
    if (!employeeNumber) continue;

    const vacation = cells[1];
    const sick = cells[2];

    for (const [bank, raw] of [
      ["vacation", vacation],
      ["sick", sick],
    ] as const) {
      if (raw === undefined || raw === "") continue;

      const hours = Number(raw);
      if (Number.isNaN(hours)) {
        errors.push(`Row ${i + 1} (#${employeeNumber}): "${raw}" is not a number`);
        continue;
      }

      const { error } = await sb.rpc("import_balance", {
        p_employee_number: employeeNumber,
        p_bank: bank,
        p_hours: hours,
        p_as_of: asOf,
        p_source: "import",
        p_note: null,
      });

      if (error) errors.push(`#${employeeNumber} ${bank}: ${error.message}`);
      else imported++;
    }
  }

  revalidatePath("/admin/balances");
  revalidatePath("/dashboard");
  return { ok: true, imported, errors };
}

/** Record an accrual rate effective from a date. Copied from payroll. */
export async function setAccrualRate(formData: FormData): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("set_accrual_rate", {
    p_employee_id: String(formData.get("employee_id")),
    p_effective: String(formData.get("effective_from")),
    p_vacation: Number(formData.get("vacation_per_period") || 0),
    p_sick: Number(formData.get("sick_per_period") || 0),
    p_note: String(formData.get("note") || "") || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/balances");
  revalidatePath("/admin/employees");
  revalidatePath("/dashboard");
  return { ok: true, message: "Accrual rate saved." };
}

export async function deleteAccrualRate(id: string): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("delete_accrual_rate", { p_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/balances");
  revalidatePath("/admin/employees");
  return { ok: true, message: "Rate removed." };
}
