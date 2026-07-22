"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

type Result =
  | { ok: true; message: string; created?: number }
  | { ok: false; error: string };

/** Generate a full calendar year of semi-monthly periods. */
export async function generateSemiMonthlyYear(year: number): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { data, error } = await sb.rpc("generate_semi_monthly_year", {
    p_year: year,
  });

  if (error) return { ok: false, error: error.message };

  const created = Number(data ?? 0);
  revalidatePath("/admin/pay-periods");
  return {
    ok: true,
    created,
    message:
      created === 0
        ? `${year} already has all 24 periods.`
        : `Created ${created} period${created === 1 ? "" : "s"} for ${year}.`,
  };
}

/**
 * Generate a bi-weekly season from a Sunday anchor.
 * The anchor is set when the first bi-weekly employee of the season
 * starts, so it varies year to year.
 */
export async function generateBiWeeklySeason(
  startDate: string,
  count: number
): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { data, error } = await sb.rpc("generate_bi_weekly_season", {
    p_start: startDate,
    p_count: count,
  });

  if (error) return { ok: false, error: error.message };

  const created = Number(data ?? 0);
  revalidatePath("/admin/pay-periods");
  return {
    ok: true,
    created,
    message:
      created === 0
        ? "Those periods already exist."
        : `Created ${created} bi-weekly period${created === 1 ? "" : "s"}.`,
  };
}

/** Delete an unused period. Blocked once any timecard exists. */
export async function deletePayPeriod(id: string): Promise<Result> {
  await requireAdmin();
  const sb = supabaseServer();

  const { error } = await sb.rpc("delete_pay_period", { p_pay_period_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/pay-periods");
  return { ok: true, message: "Period deleted." };
}
