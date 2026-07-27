import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import OvertimeReport from "./overtime-report";

export default async function OvertimeReportPage({
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
    sb.rpc("overtime_report", { p_from: from, p_to: to }),
    sb.rpc("overtime_report_totals", { p_from: from, p_to: to }),
  ]);

  return (
    <AppShell>
      <OvertimeReport
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
