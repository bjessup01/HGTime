"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

/**
 * Purge audit history older than the rolling two-year window.
 * Only removes change history — timecards, entries, ledgers, and
 * balances are never touched.
 */
export async function purgeAuditLog(): Promise<
  { ok: true; deleted: number } | { ok: false; error: string }
> {
  await requireAdmin();
  const sb = supabaseServer();

  const { data, error } = await sb.rpc("audit_purge");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/audit");
  return { ok: true, deleted: Number(data ?? 0) };
}
