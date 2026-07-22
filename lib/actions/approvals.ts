"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase";
import { requireSupervisor } from "@/lib/auth";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Supervisor approval: settles OT and posts floating holidays. */
export async function approveAsSupervisor(timecardId: string): Promise<Result> {
  await requireSupervisor();
  const sb = supabaseServer();

  const { error } = await sb.rpc("approve_timecard_as_supervisor", {
    p_timecard_id: timecardId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return { ok: true, message: "Timecard approved." };
}

/** Reverses approval and the ledger postings it created. */
export async function unapproveAsSupervisor(timecardId: string): Promise<Result> {
  await requireSupervisor();
  const sb = supabaseServer();

  const { error } = await sb.rpc("unapprove_timecard_as_supervisor", {
    p_timecard_id: timecardId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return { ok: true, message: "Approval withdrawn." };
}

/** Approve several at once. Reports per-card failures rather than aborting. */
export async function approveMany(
  timecardIds: string[]
): Promise<{ ok: true; approved: number; failed: string[] }> {
  await requireSupervisor();
  const sb = supabaseServer();

  let approved = 0;
  const failed: string[] = [];

  for (const id of timecardIds) {
    const { error } = await sb.rpc("approve_timecard_as_supervisor", {
      p_timecard_id: id,
    });
    if (error) failed.push(error.message);
    else approved++;
  }

  revalidatePath("/approvals");
  return { ok: true, approved, failed };
}
