"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

/** Save the current figures so what payroll keyed in stays auditable. */
export async function saveYearEndRun(
  fiscalYear: number,
  notes: string
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  await requireAdmin();
  const sb = supabaseServer();

  const { data, error } = await sb.rpc("save_year_end_run", {
    p_fiscal_year: fiscalYear,
    p_notes: notes || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/year-end");
  return { ok: true, runId: data as string };
}
