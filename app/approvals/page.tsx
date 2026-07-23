import AppShell from "@/components/app-shell";
import { requireSupervisor } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { currentPayPeriod, recentPayPeriods } from "@/lib/timecard";
import { Panel, Empty } from "@/components/ui";
import ApprovalQueue from "./approval-queue";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { period?: string; payroll?: string };
}) {
  await requireSupervisor();
  const sb = supabaseServer();

  const payrollType =
    (searchParams.payroll as "semi_monthly" | "bi_weekly") ?? "semi_monthly";

  const periods = await recentPayPeriods(payrollType);
  const period = searchParams.period
    ? periods.find((p) => p.id === searchParams.period) ??
      (await currentPayPeriod(payrollType))
    : await currentPayPeriod(payrollType);

  if (!period) {
    return (
      <AppShell>
        <Panel title="No pay periods">
          <Empty>
            No {payrollType.replace("_", "-")} pay periods exist yet.
          </Empty>
        </Panel>
      </AppShell>
    );
  }

  const { data: queue } = await sb.rpc("supervisor_queue", {
    p_pay_period_id: period.id,
  });

  return (
    <AppShell>
      <ApprovalQueue
        queue={queue ?? []}
        periods={periods}
        currentPeriodId={period.id}
        payrollType={payrollType}
        periodStart={period.start_date}
        periodEnd={period.end_date}
      />
    </AppShell>
  );
}
