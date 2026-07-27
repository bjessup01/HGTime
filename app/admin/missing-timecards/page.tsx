import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import MissingTimecards from "./missing-timecards";

export default async function MissingTimecardsPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const { data: periods } = await sb
    .from("pay_periods")
    .select("id, start_date, end_date, payroll_type")
    .order("start_date", { ascending: false })
    .limit(30);

  // default to the current period if none chosen
  const today = new Date().toISOString().slice(0, 10);
  const current =
    (periods ?? []).find((p: any) => p.start_date <= today && p.end_date >= today) ??
    periods?.[0];

  const periodId = searchParams.period ?? current?.id;

  const { data: rows } = periodId
    ? await sb.rpc("missing_timecard_report", { p_pay_period_id: periodId })
    : { data: [] };

  return (
    <AppShell>
      <MissingTimecards
        periods={periods ?? []}
        rows={rows ?? []}
        periodId={periodId}
      />
    </AppShell>
  );
}
