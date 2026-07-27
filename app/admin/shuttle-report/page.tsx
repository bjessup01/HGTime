import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import ShuttleReport from "./shuttle-report";

export default async function ShuttleReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; period?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const today = new Date();
  const from =
    searchParams.from ??
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = searchParams.to ?? today.toISOString().slice(0, 10);

  const [{ data: periods }, { data: rows }, { data: totals }] = await Promise.all([
    sb
      .from("pay_periods")
      .select("id, start_date, end_date, payroll_type")
      .order("start_date", { ascending: false })
      .limit(30),
    sb.rpc("shuttle_report", { p_from: from, p_to: to }),
    sb.rpc("shuttle_report_totals", { p_from: from, p_to: to }),
  ]);

  return (
    <AppShell>
      <ShuttleReport
        periods={periods ?? []}
        rows={rows ?? []}
        totals={totals ?? []}
        from={from}
        to={to}
        periodId={searchParams.period}
      />
    </AppShell>
  );
}
