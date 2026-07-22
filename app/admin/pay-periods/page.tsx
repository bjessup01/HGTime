import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import PayPeriodManager from "./pay-period-manager";

export default async function PayPeriodsPage({
  searchParams,
}: {
  searchParams: { payroll?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const payrollType =
    (searchParams.payroll as "semi_monthly" | "bi_weekly") ?? "semi_monthly";

  const [{ data: periods }, { data: coverage }, { data: seasons }] =
    await Promise.all([
      sb.rpc("pay_period_list", { p_payroll_type: payrollType }),
      sb.rpc("semi_monthly_coverage"),
      sb.rpc("bi_weekly_seasons"),
    ]);

  return (
    <AppShell>
      <PayPeriodManager
        payrollType={payrollType}
        periods={periods ?? []}
        coverage={coverage ?? []}
        seasons={seasons ?? []}
      />
    </AppShell>
  );
}
